import { Effect } from "effect"
import crypto from "crypto"
import path from "path"
import fs from "fs"
import { spawnSync } from "child_process"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { createBridgeServer } from "../../bridge/server"
import { startTunnel, type TunnelType } from "../../bridge/tunnel"
import {
  getBridgeBinaryPath,
  isBridgeDaemonOnline,
  ensureBridgeDaemonRunning,
} from "@/native/bridge-runner"
import {
  isCdpOnline,
  listTabs,
  launchChromeProfile,
  findChromeProfileByName,
} from "../../bridge/domain/cdp"

export const BridgeCommand = effectCmd({
  command: "bridge [action]",
  describe: "Manage Navi zero-API-key browser AI bridge (status, browser, start, doctor, token, install, tunnel)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Action to perform: status, browser, start, doctor, token, install, tunnel",
        type: "string",
      })
      .option("profile", {
        type: "string",
        default: "raj",
        describe: "Target Chrome profile name (defaults to 'raj')",
      })
      .option("restart", {
        type: "boolean",
        default: false,
        describe: "Force restart Chrome with CDP remote debugging port 9222 enabled",
      })
      .option("port", {
        type: "number",
        default: 4040,
        describe: "Port for workspace MCP tunnel server",
      })
      .option("tunnel", {
        type: "string",
        choices: ["cloudflare", "ngrok", "local"],
        default: "cloudflare",
        describe: "Tunnel type to expose workspace to cloud AI services",
      })
      .option("token", {
        type: "string",
        describe: "Bearer authentication token",
      })
      .option("auth", {
        type: "boolean",
        default: true,
        describe: "Require Bearer token authentication",
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
  handler: Effect.fn("Cli.bridge")(function* (args) {
    const rawAction = (args.action || "").toLowerCase()
    const bin = getBridgeBinaryPath()

    // 1. Status action
    if (rawAction === "status") {
      const online = yield* Effect.promise(() => isBridgeDaemonOnline())
      if (online) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ NaviBridge Daemon: Online" + UI.Style.TEXT_NORMAL + " (http://127.0.0.1:10086)")
        if (bin) {
          const res = spawnSync(bin, ["status"], { encoding: "utf8", windowsHide: true })
          if (res.stdout) UI.println(res.stdout.trim())
        }
      } else {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "○ NaviBridge Daemon: Offline" + UI.Style.TEXT_NORMAL)
        UI.println("  Start it with: " + UI.Style.TEXT_INFO_BOLD + "navi bridge start")
      }

      const targetProfile = String(args.profile || "raj")
      const profileInfo = findChromeProfileByName(targetProfile)
      const cdpOnline = yield* Effect.promise(() => isCdpOnline())
      if (cdpOnline) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Chrome AI Browser (Profile: ${targetProfile}): Online` + UI.Style.TEXT_NORMAL + " (CDP Port 9222)")
        const tabs = yield* Effect.promise(() => listTabs())
        const pageTabs = tabs.filter((t: any) => t.type === "page")
        for (const t of pageTabs) {
          UI.println(`   • ${t.title || "Untitled"} (${t.url})`)
        }
      } else {
        UI.println(UI.Style.TEXT_WARNING_BOLD + `○ Chrome AI Browser (Profile: ${targetProfile}): Offline / Closed` + UI.Style.TEXT_NORMAL)
        if (profileInfo) {
          UI.println(`  Detected Profile: ${profileInfo.profileName} (${profileInfo.profileFolder}${profileInfo.email ? `, ${profileInfo.email}` : ""})`)
        }
        UI.println("  Open it with: " + UI.Style.TEXT_INFO_BOLD + `navi bridge browser --profile ${targetProfile}`)
      }
      return
    }

    // 2. Browser action: Launch Chrome with the profile (default "raj") and CDP remote debugging port 9222
    if (rawAction === "browser" || rawAction === "launch") {
      const targetProfile = String(args.profile || "raj")
      const forceRestart = !!args.restart
      const profileInfo = findChromeProfileByName(targetProfile)

      UI.println(UI.Style.TEXT_INFO_BOLD + `Targeting Chrome Profile: '${targetProfile}'...` + UI.Style.TEXT_NORMAL)
      if (profileInfo) {
        UI.println(`  Profile folder: ${profileInfo.profileFolder}`)
        if (profileInfo.email) UI.println(`  Account: ${profileInfo.email}`)
      } else {
        UI.println(UI.Style.TEXT_WARNING + `  Profile '${targetProfile}' not found in Chrome Local State. Using isolated AI profile directory.`)
      }

      const cdpAlreadyOnline = yield* Effect.promise(() => isCdpOnline())
      if (cdpAlreadyOnline && !forceRestart) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Chrome AI Browser is ALREADY OPEN on CDP port 9222!" + UI.Style.TEXT_NORMAL)
        const tabs = yield* Effect.promise(() => listTabs())
        const pageTabs = tabs.filter((t: any) => t.type === "page")
        UI.println(`  Active Tabs (${pageTabs.length}):`)
        for (const t of pageTabs) {
          UI.println(`   • ${t.title || "Untitled"} (${t.url})`)
        }
        return
      }

      UI.println("Opening Chrome window with CDP remote debugging port 9222...")
      try {
        const res = yield* Effect.promise(() =>
          launchChromeProfile({
            profileName: targetProfile,
            forceRestart,
          }),
        )
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Chrome AI Browser window is OPEN on your screen!` + UI.Style.TEXT_NORMAL)
        UI.println(`  Profile: ${targetProfile} (${res.profileFolder || "Custom"})`)
        UI.println(`  CDP Debugging Port: ${res.port} (Connected)`)
        UI.println("  Opened tabs: ChatGPT, Claude, Gemini, DeepSeek")
        UI.println()
        UI.println(UI.Style.TEXT_WARNING + "👉 All logins in profile '" + targetProfile + "' are active and available.")
        UI.println("   You can query zero-API-key AI anytime from terminal:")
        UI.println(UI.Style.TEXT_INFO_BOLD + `   navi ask "Your prompt here" --provider chatgpt` + UI.Style.TEXT_NORMAL)
      } catch (err: any) {
        UI.println(UI.Style.TEXT_DANGER_BOLD + "✗ " + err.message)
      }
      return
    }

    // 2. Start action
    if (rawAction === "start") {
      UI.println(UI.Style.TEXT_INFO_BOLD + "Starting NaviBridge daemon...")
      const ok = yield* Effect.promise(() => ensureBridgeDaemonRunning())
      if (ok) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ NaviBridge daemon is running on http://127.0.0.1:10086")
      } else {
        UI.println(UI.Style.TEXT_DANGER_BOLD + "✗ Failed to start NaviBridge daemon.")
      }
      return
    }

    // 3. Doctor action
    if (rawAction === "doctor") {
      if (!bin) {
        UI.println(UI.Style.TEXT_DANGER_BOLD + "✗ navi-bridge binary not found.")
        return
      }
      const res = spawnSync(bin, ["doctor"], { encoding: "utf8", windowsHide: true })
      const out = res.stdout || res.stderr || ""
      UI.println(out.trim())
      return
    }

    // 4. Token action
    if (rawAction === "token") {
      if (!bin) {
        UI.println(UI.Style.TEXT_DANGER_BOLD + "✗ navi-bridge binary not found.")
        return
      }
      const res = spawnSync(bin, ["token"], { encoding: "utf8", windowsHide: true })
      UI.println((res.stdout || "").trim())
      return
    }

    // 5. Install action (Device-only configuration)
    if (rawAction === "install") {
      UI.println(UI.Style.TEXT_INFO_BOLD + "Configuring NaviBridge on this device...")
      const home = process.env.USERPROFILE || process.env.HOME || ""
      const extTarget = path.join(home, ".navi", "extension")

      const extSource = path.resolve(__dirname, "../../../extensions/chrome-bridge")
      if (fs.existsSync(extSource)) {
        fs.mkdirSync(extTarget, { recursive: true })
        fs.cpSync(extSource, extTarget, { recursive: true })
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ Chrome extension unpacked to: " + UI.Style.TEXT_NORMAL + extTarget)
      }

      if (bin) {
        const res = spawnSync(bin, ["token"], { encoding: "utf8", windowsHide: true })
        UI.println((res.stdout || "").trim())
      }

      yield* Effect.promise(() => ensureBridgeDaemonRunning())
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓ NaviBridge is active!")
      UI.println("  1. In Chrome, open " + UI.Style.TEXT_INFO_BOLD + "chrome://extensions" + UI.Style.TEXT_NORMAL)
      UI.println("  2. Turn on 'Developer mode' (top right)")
      UI.println("  3. Click 'Load unpacked' and select: " + UI.Style.TEXT_INFO_BOLD + extTarget + UI.Style.TEXT_NORMAL)
      return
    }

    // 6. Tunnel action or fallback to workspace MCP tunnel
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
