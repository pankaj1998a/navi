import { Effect } from "effect"
import crypto from "crypto"
import path from "path"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import { createBridgeServer } from "../../bridge/server"
import { startTunnel, type TunnelType } from "../../bridge/tunnel"

export const BridgeCommand = effectCmd({
  command: "bridge",
  describe: "connect web-based AIs (Claude, ChatGPT, Gemini) to your local Navi workspace via remote MCP",
  builder: (yargs) =>
    yargs
      .option("port", {
        type: "number",
        default: 4040,
        describe: "Local port for the bridge MCP server",
      })
      .option("tunnel", {
        type: "string",
        choices: ["cloudflare", "ngrok", "local"],
        default: "cloudflare",
        describe: "Tunnel type to expose the bridge to cloud AI services",
      })
      .option("token", {
        type: "string",
        describe: "Bearer authentication token (auto-generated if omitted)",
      })
      .option("auth", {
        type: "boolean",
        default: true,
        describe: "Require Bearer token authentication (use --no-auth to disable)",
      })
      .option("ngrok-token", {
        type: "string",
        describe: "Ngrok authtoken if using ngrok tunnel",
      })
      .option("dir", {
        type: "string",
        default: process.cwd(),
        describe: "Workspace directory to expose to the bridge",
      }),
  instance: false,
  handler: Effect.fn("Cli.bridge")(function* (args) {
    const port = args.port ?? 4040
    const tunnelType = (args.tunnel as TunnelType) ?? "cloudflare"
    const requireAuth = args.auth !== false && !(args as any)["no-auth"]
    const authToken = requireAuth ? (args.token || `navi_${crypto.randomBytes(16).toString("hex")}`) : ""
    const workspaceRoot = path.resolve(args.dir || process.cwd())

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Initializing Navi Web Bridge...")
    UI.println(`  Workspace: ${workspaceRoot}`)
    UI.println(`  Starting local server on port ${port}...`)

    const onToolCall = (toolName: string, toolArgs: Record<string, unknown>, result: string) => {
      const summary = result.length > 100 ? `${result.slice(0, 97)}...` : result
      console.log(
        `\x1b[36m[Bridge Tool Call]\x1b[0m \x1b[1m${toolName}\x1b[0m ` +
          `\x1b[90m${JSON.stringify(toolArgs)}\x1b[0m → \x1b[32m${summary.replace(/\n+/g, " ")}\x1b[0m`,
      )
    }

    const server = yield* Effect.promise(() =>
      createBridgeServer({
        port,
        authToken,
        workspaceRoot,
        onToolCall,
      }),
    )

    UI.println(UI.Style.TEXT_SUCCESS + `  ✓ Local MCP server listening on http://127.0.0.1:${port}`)
    UI.println(`  Establishing ${tunnelType} tunnel for web AI connectivity...`)

    const tunnel = yield* Effect.promise(() =>
      startTunnel({
        port,
        tunnelType,
        ngrokToken: args.ngrokToken,
      }),
    )

    const publicUrl = tunnel.publicUrl.replace(/\/+$/, "")
    const sseUrl = `${publicUrl}/sse`
    const mcpUrl = `${publicUrl}/mcp`

    UI.empty()
    console.log("\x1b[1;35m================================================================================\x1b[0m")
    console.log("\x1b[1;37m   🌉  NAVI WEB BRIDGE IS LIVE — CONNECT WEB AIs TO YOUR WORKSPACE  \x1b[0m")
    console.log("\x1b[1;35m================================================================================\x1b[0m")
    console.log()
    console.log(`  \x1b[1;32m● Status:\x1b[0m         Online (${tunnel.type.toUpperCase()} Tunnel)`)
    console.log(`  \x1b[1;34m● Public MCP URL:\x1b[0m \x1b[1;37m${sseUrl}\x1b[0m`)
    console.log(`  \x1b[1;34m● Streamable URL:\x1b[0m \x1b[1;37m${mcpUrl}\x1b[0m`)
    console.log(`  \x1b[1;33m● Bearer Token:\x1b[0m   \x1b[1m${authToken || "(None / No Authentication)"}\x1b[0m`)
    console.log(`  \x1b[1;90m● Workspace:\x1b[0m      ${workspaceRoot}`)
    console.log()
    console.log("\x1b[1;36m--------------------------------------------------------------------------------\x1b[0m")
    console.log("\x1b[1m📋 QUICK CONNECTION GUIDES:\x1b[0m")
    console.log()
    console.log("  \x1b[1;35m🟣 Claude.ai (Custom Web Connector):\x1b[0m")
    console.log("     1. In Claude.ai, open Settings → Customize → Connectors")
    console.log("     2. Click 'Add' → 'Custom' → 'Web'")
    console.log("     3. Enter Name: 'Navi Local Workspace'")
    console.log(`     4. MCP Server URL: \x1b[1;37m${sseUrl}\x1b[0m`)
    console.log(`     5. Headers: Authorization = \x1b[1;33mBearer ${authToken}\x1b[0m`)
    console.log()
    console.log("  \x1b[1;32m🟢 ChatGPT (Developer Mode MCP):\x1b[0m")
    console.log("     1. In ChatGPT, open Settings → Security & Login → Enable Developer Mode")
    console.log("     2. Settings → Plugins / MCP Connectors → Add Custom Connector")
    console.log(`     3. URL: \x1b[1;37m${sseUrl}\x1b[0m (or ${mcpUrl})`)
    console.log(`     4. Authorization Header: \x1b[1;33mBearer ${authToken}\x1b[0m`)
    console.log()
    console.log("  \x1b[1;34m🔵 Google Gemini (Spark Custom App):\x1b[0m")
    console.log("     1. Open Gemini (Pro/Advanced) → Spark → Settings → Connected Apps")
    console.log("     2. Add a Custom App for Spark")
    console.log(`     3. Server URL: \x1b[1;37m${mcpUrl}\x1b[0m`)
    console.log()
    console.log("\x1b[1;36m--------------------------------------------------------------------------------\x1b[0m")
    console.log("\x1b[90mPress Ctrl+C to stop the bridge and disconnect the tunnel.\x1b[0m\n")

    process.on("SIGINT", async () => {
      console.log("\nStopping Navi Web Bridge...")
      await tunnel.stop()
      await server.close()
      process.exit(0)
    })

    yield* Effect.never
  }),
})
