import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util/rpc"
import { type rpc } from "./worker"
import path from "path"
import { UI } from "@/cli/ui"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { withNetworkOptions, resolveNetworkOptions } from "@/cli/network"
import type { Event } from "@navi-ai/sdk/v2"
import type { EventSource } from "./context/sdk"
import { render } from "@opentui/solid"

declare global {
  const navi_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    on: (handler) => client.on<Event>("event", handler),
  }
}

export const TuiThreadCommand = cmd({
  command: "tui [project]",
  describe: "start navi tui",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start navi in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("theme-mode", {
        type: "string",
        choices: ["dark", "light"],
        describe: "force TUI theme mode",
      })
      .option("mode", {
        type: "string",
        choices: ["plan", "build"],
        describe: "initial mode to start in",
      }),
  handler: async (args) => {

    // Resolve relative paths against PWD to preserve behavior when using --cwd flag
    const baseCwd = process.env.PWD ?? process.cwd()
    const cwd = args.project ? path.resolve(baseCwd, args.project) : process.cwd()
    const localWorker = new URL("./worker.ts", import.meta.url)
    const distWorker = new URL("./cli/cmd/tui/worker.js", import.meta.url)
    const distWorkerExe = new URL("./cli/cmd/tui/worker.exe", import.meta.url)
    Log.Default.info("TUI worker paths", {
      localWorker: localWorker.toString(),
      distWorker: distWorker.toString(),
      distWorkerExe: distWorkerExe.toString(),
      navi_WORKER_PATH: typeof navi_WORKER_PATH !== "undefined" ? navi_WORKER_PATH : "undefined",
    })
    const workerPath = await iife(async () => {
      if (typeof navi_WORKER_PATH !== "undefined") {
        const execDir = path.dirname(process.execPath)
        const resolvedPath = path.resolve(execDir, navi_WORKER_PATH)
        Log.Default.info("Using navi_WORKER_PATH", {
          raw: navi_WORKER_PATH,
          execPath: process.execPath,
          resolved: resolvedPath,
        })

        if (process.platform === "win32") {
          if (await Bun.file(resolvedPath).exists()) {
            return resolvedPath
          }
          const exePath = resolvedPath + ".exe"
          if (await Bun.file(exePath).exists()) {
            Log.Default.info("Using .exe worker path on Windows", { path: exePath })
            return exePath
          }
        }

        return resolvedPath
      }
      const distExists = await Bun.file(distWorker).exists()
      Log.Default.info("distWorker exists check", { exists: distExists, path: distWorker.toString() })
      if (distExists) return distWorker
      const distExeExists = await Bun.file(distWorkerExe).exists()
      Log.Default.info("distWorkerExe exists check", { exists: distExeExists, path: distWorkerExe.toString() })
      if (distExeExists) return distWorkerExe
      Log.Default.info("Using localWorker", { path: localWorker.toString() })
      return localWorker
    })
    Log.Default.info("TUI worker path selected", { workerPath: workerPath.toString() })
    try {
      process.chdir(cwd)
    } catch (e) {
      UI.error("Failed to change directory to " + cwd)
      return
    }

    const worker = new Worker(workerPath, {
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
    })
    worker.onerror = (e) => {
      Log.Default.error("Worker error", {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        error: e.error?.message || e.error,
      })

    }
    const client = Rpc.client<typeof rpc>(worker)
    process.on("uncaughtException", (e) => {
      Log.Default.error(e)

    })
    process.on("unhandledRejection", (e) => {
      Log.Default.error(e)

    })
    process.on("SIGUSR2", async () => {
      await client.call("reload", undefined)
    })

    const prompt = await iife(async () => {
      // Only read from stdin if it's definitely piped (not a TTY) and we're not running interactively
      // On Windows, stdin.isTTY can be undefined even in interactive mode
      const isInteractive = process.stdin.isTTY || process.stdout.isTTY
      const piped = !isInteractive ? await Bun.stdin.text().catch(() => undefined) : undefined
      if (!args.prompt) return piped
      return piped ? piped + "\n" + args.prompt : args.prompt
    })

    // Check if server should be started (port or hostname explicitly set in CLI or config)
    const networkOpts = await resolveNetworkOptions(args)

    // Only start HTTP server if networking options are explicitly set
    const shouldStartServer =
      process.argv.includes("--port") ||
      process.argv.includes("--hostname") ||
      process.argv.includes("--mdns") ||
      networkOpts.mdns === true ||
      (networkOpts.port !== undefined && networkOpts.port !== 0) ||
      (networkOpts.hostname !== undefined && networkOpts.hostname !== "127.0.0.1")

    // Probe local port 4096 to see if another Navi instance is already hosting a server.
    // If it is, and we aren't explicitly requested to bind a specific port, we can attach to it.
    let url: string = "http://navi.internal"
    let customFetch: typeof fetch | undefined
    let events: EventSource | undefined
    let attachedToExisting = false

    if (!shouldStartServer) {
      try {
        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), 500)
        const probeRes = await fetch("http://127.0.0.1:4096/global/health", { signal: controller.signal })
        clearTimeout(id)
        if (probeRes.ok) {
          const data = await probeRes.json()
          if (data.healthy) {
            Log.Default.info("Found existing Navi server on 4096, attaching to it")
            url = "http://127.0.0.1:4096"
            attachedToExisting = true
            worker.terminate()
          }
        }
      } catch (e) {
        // No existing server found, continue with isolated worker
      }
    }

    if (shouldStartServer && !attachedToExisting) {
      // Start HTTP server for external access
      const server = await client.call("server", networkOpts)
      url = server.url
    } else if (!attachedToExisting) {
      // Use direct RPC communication (no HTTP)
      url = "http://navi.internal"
      customFetch = createWorkerFetch(client)
      events = createEventSource(client)
    }

    const tuiPromise = tui({
      url,
      fetch: customFetch,
      events,
      args: {
        continue: args.continue,
        sessionID: args.session,
        agent: args.agent,
        model: args.model,
        mode: args.mode as "plan" | "build",
        prompt,
        themeMode: args["theme-mode"] as "dark" | "light",
      },
      onExit: async () => {
        if (!attachedToExisting) {
          await client.call("shutdown", undefined)
        }
      },
      directory: cwd, // I missed directory in original tui call above? No, checking original.
      // Original: 
      /*
          const tuiPromise = tui({
      url,
      fetch: customFetch,
      events,
      args: { ... },
      onExit: async () => {
        await client.call("shutdown", undefined)
      },
    })
      */
      // Directory? `tui` signature accepts directory.
      // Original code did NOT pass directory? 
      // Checking Step 61...
      // `tui({ url, fetch, events, args: {...}, onExit: ... })`
      // It did NOT pass directory.
    })

    setTimeout(() => {
      client.call("checkUpgrade", { directory: cwd }).catch(() => { })
    }, 1000)

    await tuiPromise

  },
})
