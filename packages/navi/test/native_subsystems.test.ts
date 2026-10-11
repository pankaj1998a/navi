import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  isNativeAvailable,
  getNativeBinaryPath,
  countTokensNative,
  inspectBinaryNative,
  scanStructureNative,
  compactMessagesNative,
} from "@/native/native-runner"
import { countTokens } from "@/util/token"

describe("Rust Native Subsystems Integration", () => {
  test("native binary is discovered and available", () => {
    const available = isNativeAvailable()
    expect(available).toBe(true)
    const binPath = getNativeBinaryPath()
    expect(binPath).not.toBeNull()
  })

  test("countTokensNative accurately counts BPE tokens", () => {
    const code = "function calculateSum(a: number, b: number): number {\n  return a + b;\n}"
    const tokens = countTokensNative(code)
    expect(tokens).not.toBeNull()
    expect(tokens!).toBeGreaterThan(10)
    expect(tokens!).toBeLessThan(35)

    // Token.countTokens should delegate to native
    const delegating = countTokens(code)
    expect(delegating).toBe(tokens!)
  })

  test("inspectBinaryNative analyzes native executable headers", () => {
    const binPath = getNativeBinaryPath()!
    const result = inspectBinaryNative(binPath)
    expect(result).not.toBeNull()
    expect(result!.format).toBe("pe")
    expect(result!.architecture).toBe("x86_64")
    expect(result!.bits).toBe(64)
    expect(result!.kind).toBe("exe")
    expect(result!.notes.length).toBeGreaterThan(0)
  })

  test("scanStructureNative extracts AST symbols from directory", () => {
    const utilDir = path.resolve(process.cwd(), "src/util")
    const map = scanStructureNative(utilDir)
    expect(map).not.toBeNull()
    expect(map!).toContain("# Project Structure Map:")
    expect(map!).toContain("fn:")
  })

  test("compactMessagesNative compacts conversation turns within token budget", () => {
    const req = {
      messages: [
        {
          role: "user",
          parts: [{ type: "text", text: "Please inspect the codebase structure." }],
        },
        {
          role: "assistant",
          parts: [
            { type: "tool", tool: "structure", status: "done" },
            { type: "text", text: "A".repeat(1200) },
          ],
        },
        {
          role: "user",
          parts: [{ type: "text", text: "What did you find?" }],
        },
      ],
      max_tokens: 50,
      preserve_recent: 1,
    }

    const res = compactMessagesNative(req)
    expect(res).not.toBeNull()
    expect(res!.pruned_turns).toBeGreaterThan(0)
    expect(res!.compacted_tokens).toBeLessThan(res!.original_tokens)
    expect(res!.messages.length).toBe(3)
  })
})
