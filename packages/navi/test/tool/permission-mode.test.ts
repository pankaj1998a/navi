import { describe, expect, test } from "bun:test"
import { PermissionModeGetTool, PermissionModeSetTool, PermissionModeCycleTool } from "../../src/tool/permission-mode"
import { SuggestPermissionModeTool } from "../../src/tool/advanced-features"
import { cleanupModeState, getPermissionMode, initializeModeState } from "../../src/permission/mode-manager"

const ctx = (sessionID: string, agent = "build") => ({
  sessionID,
  messageID: "",
  callID: "",
  agent,
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
})

const getTool = await PermissionModeGetTool.init()
const setTool = await PermissionModeSetTool.init()
const cycleTool = await PermissionModeCycleTool.init()
const suggestTool = await SuggestPermissionModeTool.init()

describe("tool.permission-mode", () => {
  test("uses the active session instead of a global default", async () => {
    initializeModeState("session-a", "safe")
    initializeModeState("session-b", "allow-all")

    try {
      await setTool.execute({ mode: "ask" }, ctx("session-a"))

      const a = await getTool.execute({}, ctx("session-a"))
      const b = await getTool.execute({}, ctx("session-b"))
      const cycled = await cycleTool.execute({}, ctx("session-a"))

      expect(a.metadata.mode).toBe("ask")
      expect(a.output).toContain("Ask to Edit")
      expect(b.metadata.mode).toBe("allow-all")
      expect(b.output).toContain("Execute")
      expect(cycled.metadata.mode).toBe("allow-all")
      expect(getPermissionMode("session-b")).toBe("allow-all")
    } finally {
      cleanupModeState("session-a")
      cleanupModeState("session-b")
    }
  })

  test("suggests a Claude-like workflow, agent, and mode", async () => {
    initializeModeState("session-c", "safe")

    try {
      const result = await suggestTool.execute(
        {
          task: "read and explain the auth flow",
        },
        ctx("session-c", "build"),
      )

      expect(result.metadata.workflow).toBe("explore")
      expect(result.metadata.agent).toBe("explore")
      expect(result.metadata.mode).toBe("safe")
      expect(result.output).toContain("Claude")
      expect(result.output).toContain("Recommended agent: explore")
      expect(result.output).toContain("Recommended mode: Explore (safe)")
    } finally {
      cleanupModeState("session-c")
    }
  })
})
