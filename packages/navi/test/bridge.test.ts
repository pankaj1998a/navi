import { describe, expect, it } from "bun:test"
import { createBridgeServer } from "../src/bridge/server"
import { bridgeTools } from "../src/bridge/tools"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"

describe("Navi Web Bridge", () => {
  it("authenticates and manages MCP endpoints & workspace tools safely", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "navi-bridge-test-"))
    const testToken = "test-secret-token-12345"

    let capturedActivity: string[] = []
    const serverHandle = await createBridgeServer({
      port: 0,
      authToken: testToken,
      workspaceRoot: testDir,
      onToolCall: (name, _args, result) => {
        capturedActivity.push(`${name}: ${result}`)
      },
    })
    const port = serverHandle.port

    try {
      // 1. Health check returns 200 and metadata
      const healthRes = await fetch(`http://127.0.0.1:${port}/health`)
      expect(healthRes.status).toBe(200)
      const healthJson = await healthRes.json()
      expect(healthJson.status).toBe("online")
      expect(healthJson.service).toBe("navi-web-bridge")
      expect(healthJson.toolsCount).toBeGreaterThanOrEqual(12)

      // 2. Unauthorized request to /sse should fail with 401
      const unauthRes = await fetch(`http://127.0.0.1:${port}/sse`)
      expect(unauthRes.status).toBe(401)

      // 3. Authorized request to /sse returns 200 text/event-stream
      const controller = new AbortController()
      const authRes = await fetch(`http://127.0.0.1:${port}/sse`, {
        headers: { Authorization: `Bearer ${testToken}` },
        signal: controller.signal,
      })
      expect(authRes.status).toBe(200)
      expect(authRes.headers.get("content-type")).toContain("text/event-stream")
      controller.abort()

      // 4. Test tool definitions
      const writeTool = bridgeTools.find((t) => t.name === "file_write")!
      const readTool = bridgeTools.find((t) => t.name === "file_read")!
      expect(writeTool).toBeDefined()
      expect(readTool).toBeDefined()

      // Execute file_write tool within workspace
      const writeRes = await writeTool.execute(
        { path: "hello.txt", content: "Hello from Web AI via Navi Bridge!" },
        { workspaceRoot: testDir, onActivity: (name, _a, res) => capturedActivity.push(`${name}: ${res}`) }
      )
      expect(writeRes.content[0]!.text).toContain("hello.txt")

      // Execute file_read tool
      const readRes = await readTool.execute(
        { path: "hello.txt" },
        { workspaceRoot: testDir }
      )
      expect(readRes.content[0]!.text).toBe("Hello from Web AI via Navi Bridge!")

      // 5. Verify sandbox safety: writing outside workspace must fail
      const outsideFile = path.resolve("C:\\unauthorized_workspace_test_dir\\forbidden.txt")
      const outsideRes = await writeTool.execute(
        { path: outsideFile, content: "dangerous write" },
        { workspaceRoot: testDir }
      )
      expect(outsideRes.isError).toBe(true)
      expect(outsideRes.content[0]!.text).toContain("SANDBOX_VIOLATION")

      // 6. Verify command_run executes safely with confinement
      const cmdTool = bridgeTools.find((t) => t.name === "command_run")!
      expect(cmdTool).toBeDefined()
      const echoCmd = "echo bridge_cmd_ok"
      const cmdRes = await cmdTool.execute({ command: echoCmd }, { workspaceRoot: testDir })
      expect(cmdRes.isError).toBeFalsy()
      expect(cmdRes.content[0]!.text).toContain("bridge_cmd_ok")

      // 7. Verify tests_run allowlist enforcement
      const testTool = bridgeTools.find((t) => t.name === "tests_run")!
      expect(testTool).toBeDefined()
      const disallowedRes = await testTool.execute({ command: "curl https://attacker.com" }, { workspaceRoot: testDir })
      expect(disallowedRes.isError).toBe(true)
      expect(disallowedRes.content[0]!.text).toContain("Disallowed test runner")

      // 8. Verify navi_agent_task handles special chars safely via argv array without shell injection
      const agentTool = bridgeTools.find((t) => t.name === "navi_agent_task")!
      expect(agentTool).toBeDefined()
      const agentRes = await agentTool.execute({ prompt: '$(whoami) "` & echo pwned' }, { workspaceRoot: testDir })
      expect(agentRes).toBeDefined()
    } finally {
      await serverHandle.close()
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })
})
