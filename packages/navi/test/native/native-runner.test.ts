import { describe, expect, it } from "bun:test"
import * as path from "path"
import * as fs from "fs"
import {
  isNativeAvailable,
  getNativeBinaryPath,
  scrubSecretsNative,
  countLinesNative,
  applyPatchNative,
} from "../../src/native/native-runner"

describe("Native Rust Engine (codex & grok-build ported)", () => {
  it("detects compiled native binary", () => {
    expect(isNativeAvailable()).toBe(true)
    const binPath = getNativeBinaryPath()
    expect(binPath).not.toBeNull()
    expect(fs.existsSync(binPath!)).toBe(true)
  })

  it("redacts secrets fast via native Rust regex DFA (xai-grok-secrets)", () => {
    const input = "Here is my Grok key: xai-abcdef1234567890abcdef123456 and sk-proj-12345678901234567890"
    const out = scrubSecretsNative(input)
    expect(out).not.toBeNull()
    expect(out).toContain("[REDACTED_SECRET]")
    expect(out).not.toContain("xai-abcdef")
    expect(out).not.toContain("sk-proj-")
  })

  it("counts lines fast via native Rust file reader without JS heap buffering", () => {
    const tmpFile = path.resolve(process.cwd(), "test-line-count.tmp")
    fs.writeFileSync(tmpFile, "line 1\nline 2\nline 3\nline 4\nline 5\n")
    try {
      const count = countLinesNative(tmpFile)
      expect(count).toBe(5)
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
    }
  })

  it("applies unified patch with fuzzy seek_sequence (codex-apply-patch)", () => {
    const tmpDir = path.resolve(process.cwd(), "scratch-patch-test")
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const targetFile = path.join(tmpDir, "hello.txt")
    fs.writeFileSync(targetFile, "Hello World\nLine to replace\nKeep this line\n")

    const patchText = [
      "*** Begin Patch",
      "*** Update File: hello.txt",
      "@@ Line to replace",
      "-Line to replace",
      "+Line has been replaced by Rust engine",
      "*** End Patch",
    ].join("\n")

    try {
      const res = applyPatchNative(tmpDir, patchText)
      expect(res).not.toBeNull()
      expect(res!.success).toBe(true)
      expect(res!.modified_files).toContain("hello.txt")

      const newContent = fs.readFileSync(targetFile, "utf-8")
      expect(newContent).toContain("Line has been replaced by Rust engine")
      expect(newContent).not.toContain("Line to replace")
      expect(newContent).toContain("Keep this line")
    } finally {
      if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile)
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir)
    }
  })
})
