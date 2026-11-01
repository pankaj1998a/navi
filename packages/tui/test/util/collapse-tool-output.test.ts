import { describe, expect, test } from "bun:test"
import { collapseToolOutput } from "../../src/util/collapse-tool-output"

describe("collapseToolOutput", () => {
  test("returns unchanged output if within limits", () => {
    const input = "line1\nline2\nline3"
    const result = collapseToolOutput(input, 5, 50)
    expect(result).toEqual({ output: input, overflow: false })
  })

  test("truncates by lines if line count exceeds maxLines", () => {
    const input = "line1\nline2\nline3\nline4"
    const result = collapseToolOutput(input, 2, 50)
    expect(result).toEqual({ output: "line1\nline2\n…", overflow: true })
  })

  test("truncates by characters if preview exceeds maxChars", () => {
    const input = "abcdefghijklmnopqrstuvwxyz"
    const result = collapseToolOutput(input, 5, 10)
    expect(result).toEqual({ output: "abcdefghi…", overflow: true })
  })

  test("handles unicode characters safely without breaking", () => {
    const input = "🚀🌟🔥🎉✨👍🤖"
    const result = collapseToolOutput(input, 5, 5)
    expect(result.overflow).toBe(true)
    expect(result.output.endsWith("…")).toBe(true)
  })

  test("handles large input without heap blowout", () => {
    const large = "a".repeat(100_000) + "\n" + "b".repeat(100_000)
    const result = collapseToolOutput(large, 1, 100)
    expect(result.overflow).toBe(true)
    expect(result.output.length).toBe(100)
  })
})
