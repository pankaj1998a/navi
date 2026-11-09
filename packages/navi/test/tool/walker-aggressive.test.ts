import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { globNative, grepNative } from "../../src/native/native-runner"

describe("Phase 5: In-Process Gitignore Walker & Memory-Mapped Grep Engine (Aggressive)", () => {
  const testDir = path.join(os.tmpdir(), `navi-walker-test-${Date.now()}`)

  beforeAll(() => {
    fs.mkdirSync(path.join(testDir, "src", "nested"), { recursive: true })
    fs.mkdirSync(path.join(testDir, "ignored_dir"), { recursive: true })
    fs.mkdirSync(path.join(testDir, "docs"), { recursive: true })

    // .gitignore
    fs.writeFileSync(
      path.join(testDir, ".gitignore"),
      "ignored_dir/\n*.secret\n*.log\nnode_modules/\n",
    )

    // Regular searchable files
    fs.writeFileSync(
      path.join(testDir, "src", "index.ts"),
      "export const API_URL = 'https://api.navi.ai/v1';\nconsole.log('bootstrapping');\n",
    )
    fs.writeFileSync(
      path.join(testDir, "src", "nested", "service.ts"),
      "// Service implementation\nexport function fetchConfig() {\n  return { endpoint: 'https://api.navi.ai/v1' }\n}\n",
    )
    fs.writeFileSync(
      path.join(testDir, "docs", "readme.md"),
      "# Navi Documentation\nVisit https://api.navi.ai/v1 for more info.\n",
    )

    // Ignored files (should NOT match)
    fs.writeFileSync(
      path.join(testDir, "ignored_dir", "leak.ts"),
      "export const SHOULD_NOT_FIND = 'https://api.navi.ai/v1';\n",
    )
    fs.writeFileSync(
      path.join(testDir, "credentials.secret"),
      "secret_key=https://api.navi.ai/v1\n",
    )
    fs.writeFileSync(
      path.join(testDir, "audit.log"),
      "2026-11-09: request to https://api.navi.ai/v1\n",
    )

    // Binary file with null bytes (should NOT match)
    const binaryBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x02, 0x01, 0x00])
    fs.writeFileSync(path.join(testDir, "src", "native.bin"), binaryBuffer)
  })

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {}
  })

  test("grepNative respects .gitignore and finds exact matches across directories", () => {
    const res = grepNative({
      root: testDir,
      pattern: "https://api\\.navi\\.ai/v1",
    })

    expect(res).not.toBeNull()
    expect(res?.items.length).toBe(3)

    const matchedPaths = res!.items.map((i) => i.path.text.toLowerCase())
    expect(matchedPaths.some((p) => p.includes("index.ts"))).toBe(true)
    expect(matchedPaths.some((p) => p.includes("service.ts"))).toBe(true)
    expect(matchedPaths.some((p) => p.includes("readme.md"))).toBe(true)

    // Ensure ignored files are strictly excluded
    expect(matchedPaths.some((p) => p.includes("ignored_dir"))).toBe(false)
    expect(matchedPaths.some((p) => p.includes("leak.ts"))).toBe(false)
    expect(matchedPaths.some((p) => p.includes("credentials.secret"))).toBe(false)
    expect(matchedPaths.some((p) => p.includes("audit.log"))).toBe(false)
    expect(matchedPaths.some((p) => p.includes("native.bin"))).toBe(false)
  })

  test("grepNative supports glob pattern filtering", () => {
    const res = grepNative({
      root: testDir,
      pattern: "https://api\\.navi\\.ai/v1",
      glob: ["*.ts"],
    })

    expect(res).not.toBeNull()
    expect(res?.items.length).toBe(2)

    for (const item of res!.items) {
      expect(item.path.text.endsWith(".ts")).toBe(true)
      expect(item.path.text.endsWith(".md")).toBe(false)
    }
  })

  test("grepNative supports case-insensitive search", () => {
    const resCaseInsensitive = grepNative({
      root: testDir,
      pattern: "bootstrap",
      case_insensitive: true,
    })

    expect(resCaseInsensitive).not.toBeNull()
    expect(resCaseInsensitive?.items.length).toBe(1)
    expect(resCaseInsensitive?.items[0]?.lines.text).toContain("bootstrapping")

    const resCaseSensitive = grepNative({
      root: testDir,
      pattern: "BOOTSTRAP",
      case_insensitive: false,
    })

    expect(resCaseSensitive).not.toBeNull()
    expect(resCaseSensitive?.items.length).toBe(0)
  })

  test("grepNative respects max_matches and sets partial flag", () => {
    const res = grepNative({
      root: testDir,
      pattern: "https://api\\.navi\\.ai/v1",
      max_matches: 1,
    })

    expect(res).not.toBeNull()
    expect(res?.items.length).toBe(1)
    expect(res?.partial).toBe(true)
    expect(res?.total_matches).toBe(3)
  })

  test("globNative lists all gitignore-compliant files matching glob pattern", () => {
    const files = globNative({
      root: testDir,
      glob: ["*.ts"],
    })

    expect(files).not.toBeNull()
    expect(files!.length).toBe(2)

    const normalized = files!.map((f) => f.replace(/\\/g, "/"))
    expect(normalized).toContain("src/index.ts")
    expect(normalized).toContain("src/nested/service.ts")

    // Ignored files should never appear
    expect(normalized.some((f) => f.includes("ignored_dir"))).toBe(false)
    expect(normalized.some((f) => f.includes(".secret"))).toBe(false)
  })

  test("high-throughput parallel search across 150 synthetic files", () => {
    const benchDir = path.join(testDir, "bench")
    fs.mkdirSync(benchDir, { recursive: true })

    for (let i = 0; i < 150; i++) {
      fs.writeFileSync(
        path.join(benchDir, `file_${i}.txt`),
        `Line 1: preamble\nLine 2: file index ${i}\nLine 3: ${i % 5 === 0 ? "SEARCH_BENCH_TOKEN" : "other data"}\nLine 4: trailing info\n`,
      )
    }

    const t0 = performance.now()
    const res = grepNative({
      root: benchDir,
      pattern: "SEARCH_BENCH_TOKEN",
    })
    const elapsed = performance.now() - t0

    expect(res).not.toBeNull()
    // Every 5th file has the token: 150 / 5 = 30 matches
    expect(res?.items.length).toBe(30)
    expect(res?.files_searched).toBeGreaterThanOrEqual(150)
    // Parallel Rayon scan should complete in < 250ms
    expect(elapsed).toBeLessThan(250)
  })
})
