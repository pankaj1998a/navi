import { describe, expect, test } from "bun:test"
import { native } from "../src/memory/native"

describe("Native Rust Snapshot & Walker Accelerators", () => {
  test("native binding is loaded and available", () => {
    expect(native.isAvailable).toBe(true)
  })

  test("computes unified diff using Rust Myers algorithm", () => {
    if (!native.generateUnifiedDiff) return
    const before = "function foo() {\n  return 1\n}\n"
    const after = "function foo() {\n  return 2\n}\n"
    const diff = native.generateUnifiedDiff(before, after, "foo.ts", 3)
    expect(diff).toContain("--- a/foo.ts")
    expect(diff).toContain("+++ b/foo.ts")
    expect(diff).toContain("-  return 1")
    expect(diff).toContain("+  return 2")
  })

  test("computes batch diffs in native Rust", () => {
    if (!native.snapshotBatchDiff) return
    const items = [
      {
        file: "index.ts",
        before: "export const x = 1\n",
        after: "export const x = 2\nexport const y = 3\n",
        binary: false,
      },
      {
        file: "image.png",
        before: "old-binary",
        after: "new-binary",
        binary: true,
      },
    ]

    const diffs = native.snapshotBatchDiff(items)
    expect(diffs.length).toBe(2)
    const first = diffs[0]
    const second = diffs[1]
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (!first || !second) return

    expect(first.file).toBe("index.ts")
    expect(first.additions).toBe(2)
    expect(first.deletions).toBe(1)
    expect(first.status).toBe("modified")
    expect(first.patch).toContain("+++ index.ts")

    expect(second.file).toBe("image.png")
    expect(second.patch).toBe("")
  })

  test("computes fast working tree hash in native Rust", () => {
    if (!native.snapshotTreeHash) return
    const hash = native.snapshotTreeHash(process.cwd())
    expect(typeof hash).toBe("string")
    expect(hash.length).toBeGreaterThan(0)
    expect(hash).toContain(":")
  })

  test("scans directory files using native Rust walker", () => {
    if (!native.walkerScan) return
    const res = native.walkerScan({
      root: process.cwd(),
      max_depth: 2,
      extensions: [".json"],
      max_files: 10,
    })
    expect(Array.isArray(res)).toBe(true)
    expect(res.length).toBeGreaterThan(0)
    const firstRes = res[0]
    expect(firstRes).toBeDefined()
    if (!firstRes) return
    expect(firstRes.path.endsWith(".json")).toBe(true)
  })

  test("registers process supervision PID", () => {
    if (!native.processRegister) return
    const ok = native.processRegister(process.pid)
    expect(ok).toBe(true)
  })
})
