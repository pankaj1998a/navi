import { describe, test, expect, beforeEach } from "bun:test"
import { applyToolGuard, resetToolGuard } from "@/tool/guard"

describe("applyToolGuard", () => {
  const sessionID = "session-123"
  const agent = "build"

  beforeEach(() => {
    resetToolGuard(sessionID)
  })

  test("does not add reminder for single tool execution", () => {
    const output = applyToolGuard({
      toolId: "read",
      sessionID,
      agent,
      args: { path: "src/index.ts" },
      output: "file contents",
    })
    expect(output).toBe("file contents")
  })

  test("does not add reminder for 2 consecutive identical tool calls", () => {
    applyToolGuard({
      toolId: "read",
      sessionID,
      agent,
      args: { path: "src/index.ts" },
      output: "file contents",
    })

    const output2 = applyToolGuard({
      toolId: "read",
      sessionID,
      agent,
      args: { path: "src/index.ts" },
      output: "file contents",
    })
    expect(output2).toBe("file contents")
  })

  test("adds gentle reminder on 3rd consecutive identical tool call", () => {
    applyToolGuard({ toolId: "read", sessionID, agent, args: { path: "src/index.ts" }, output: "file contents" })
    applyToolGuard({ toolId: "read", sessionID, agent, args: { path: "src/index.ts" }, output: "file contents" })

    const output3 = applyToolGuard({
      toolId: "read",
      sessionID,
      agent,
      args: { path: "src/index.ts" },
      output: "file contents",
    })
    expect(output3).toContain("file contents")
    expect(output3).toContain("[System Guard Note: You are repeating the exact same tool call (\"read\")")
  })

  test("adds detailed reminder on 4th+ consecutive identical tool call", () => {
    applyToolGuard({ toolId: "read", sessionID, agent, args: { path: "src/index.ts" }, output: "file contents" })
    applyToolGuard({ toolId: "read", sessionID, agent, args: { path: "src/index.ts" }, output: "file contents" })
    applyToolGuard({ toolId: "read", sessionID, agent, args: { path: "src/index.ts" }, output: "file contents" })

    const output4 = applyToolGuard({
      toolId: "read",
      sessionID,
      agent,
      args: { path: "src/index.ts" },
      output: "file contents",
    })
    expect(output4).toContain("file contents")
    expect(output4).toContain("[System Guard Note: Repeated tool call detected (read × 4)")
  })

  test("resets count if arguments change", () => {
    applyToolGuard({ toolId: "read", sessionID, agent, args: { path: "src/index.ts" }, output: "file contents" })
    applyToolGuard({ toolId: "read", sessionID, agent, args: { path: "src/index.ts" }, output: "file contents" })

    // Call with different path
    const outputNewArg = applyToolGuard({
      toolId: "read",
      sessionID,
      agent,
      args: { path: "src/other.ts" },
      output: "other contents",
    })
    expect(outputNewArg).toBe("other contents")
  })
})
