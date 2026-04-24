import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { Log } from "./util/log"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { Filesystem } from "./util/filesystem"
import { EOL } from "os"
import path from "path"
import { Global } from "./global"
import { Database } from "./storage/db"
import { errorMessage } from "./util/error"
import { FormatError } from "./cli/error"

const __start = performance.now()
const argv = hideBin(process.argv)

function isLightweightStartupRequest(args: string[]): boolean {
  return (
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    args.includes("-v") ||
    args[0] === "help" ||
    args[0] === "completion"
  )
}

/**
 * Helper to lazy-load command modules. 
 * This prevents loading the entire agent system until a command is actually run.
 */
const commands: Record<string, () => Promise<any>> = {
  "./cli/cmd/tui/thread": () => import("./cli/cmd/tui/thread"),
  "./cli/cmd/acp": () => import("./cli/cmd/acp"),
  "./cli/cmd/mcp": () => import("./cli/cmd/mcp"),
  "./cli/cmd/tui/attach": () => import("./cli/cmd/tui/attach"),
  "./cli/cmd/run": () => import("./cli/cmd/run"),
  "./cli/cmd/generate": () => import("./cli/cmd/generate"),
  "./cli/cmd/vibe": () => import("./cli/cmd/vibe"),
  "./cli/cmd/debug": () => import("./cli/cmd/debug"),
  "./cli/cmd/account": () => import("./cli/cmd/account"),
  "./cli/cmd/providers": () => import("./cli/cmd/providers"),
  "./cli/cmd/agent": () => import("./cli/cmd/agent"),
  "./cli/cmd/upgrade": () => import("./cli/cmd/upgrade"),
  "./cli/cmd/uninstall": () => import("./cli/cmd/uninstall"),
  "./cli/cmd/serve": () => import("./cli/cmd/serve"),
  "./cli/cmd/web": () => import("./cli/cmd/web"),
  "./cli/cmd/models": () => import("./cli/cmd/models"),
  "./cli/cmd/stats": () => import("./cli/cmd/stats"),
  "./cli/cmd/export": () => import("./cli/cmd/export"),
  "./cli/cmd/import": () => import("./cli/cmd/import"),
  "./cli/cmd/github": () => import("./cli/cmd/github"),
  "./cli/cmd/pr": () => import("./cli/cmd/pr"),
  "./cli/cmd/session": () => import("./cli/cmd/session"),
  "./cli/cmd/plug": () => import("./cli/cmd/plug"),
  "./cli/cmd/db": () => import("./cli/cmd/db"),
  "./cli/cmd/eval": () => import("./cli/cmd/eval"),
}

function lazy(cmd: string, describe: string, modulePath: string) {
  const load = commands[modulePath] || (() => import(modulePath))
  return {
    command: cmd,
    describe: describe,
    builder: (y: any) => load().then(m => {
        const key = Object.keys(m).find(k => k.endsWith('Command'))
        const mod = key ? m[key] : (m.default || m)
        return mod.builder ? mod.builder(y) : y
    }),
    handler: (args: any) => load().then(m => {
        const key = Object.keys(m).find(k => k.endsWith('Command'))
        const mod = key ? m[key] : (m.default || m)
        return mod.handler(args)
    })
  }
}

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: errorMessage(e),
  })
})

const cli = yargs(argv)
  .parserConfiguration({ "populate--": true })
  .scriptName("Navi")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", Installation.VERSION)
  .alias("version", "v")
  .option("print-logs", {
    describe: "print logs to stderr",
    type: "boolean",
  })
  .option("log-level", {
    describe: "log level",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "run without external plugins",
    type: "boolean",
  })
  .middleware(async (opts) => {
    if (opts.pure) {
      process.env.NAVI_PURE = "1"
    }

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        return "INFO"
      })(),
    })

    process.env.AGENT = "1"
    process.env.Navi = "1"
    process.env.NAVI_PID = String(process.pid)

    if (isLightweightStartupRequest(argv)) {
      return
    }

    await Global.init()

    Log.Default.debug("Navi", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })

    const marker = Database.Path
    if (!(await Filesystem.exists(marker))) {
      const { JsonMigration } = await import("./storage/json-migration")
      const tty = process.stderr.isTTY
      const width = 36
      const orange = "\x1b[38;5;214m"
      const muted = "\x1b[0;2m"
      const reset = "\x1b[0m"
      let last = -1
      if (tty) process.stderr.write("\x1b[?25l")
      try {
        await JsonMigration.run(Database.Client().$client, {
          progress: (event) => {
            const percent = Math.floor((event.current / event.total) * 100)
            if (percent === last && event.current !== event.total) return
            last = percent
            if (tty) {
              const fill = Math.round((percent / 100) * width)
              const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
              process.stderr.write(
                `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
              )
              if (event.current === event.total) process.stderr.write("\n")
            } else {
              process.stderr.write(`sqlite-migration:${percent}${EOL}`)
            }
          },
        })
      } finally {
        if (tty) process.stderr.write("\x1b[?25h")
        else {
          process.stderr.write(`sqlite-migration:done${EOL}`)
        }
      }
    }

    const jsonlMarker = path.join(Global.Path.data, "jsonl-migration.done")
    if (await Filesystem.exists(marker) && !(await Filesystem.exists(jsonlMarker))) {
      const { JsonlMigration } = await import("./storage/sqlite-to-jsonl")
      try {
        await JsonlMigration.run(marker)
        await Filesystem.write(jsonlMarker, "done")
      } catch (err) {
        Log.Default.error("jsonl migration failed", { err: errorMessage(err) })
      }
    }

    // Initialize Auto-Updater Background Check (backgrounded, no await)
    import("./util/auto-updater").then(m => m.AutoUpdater.init()).catch(err => {
      Log.Default.warn("failed to initialize auto-updater", { err: errorMessage(err) })
    })

    if (Installation.isLocal() && process.env.NAVI_PERF) {
      console.log(`Total startup (until parse): ${Math.round(performance.now() - __start)}ms`)
    }
  })
  .usage("\n" + UI.logo())
  .completion("completion", "generate shell completion script")
  .command(lazy("$0", "Start the main TUI", "./cli/cmd/tui/thread"))
  .command(lazy("acp", "Agent Client Protocol server mode", "./cli/cmd/acp"))
  .command(lazy("mcp", "Model Context Protocol server mode", "./cli/cmd/mcp"))
  .command(lazy("thread", "TUI thread mode", "./cli/cmd/tui/thread"))
  .command(lazy("attach", "Attach to a running Navi server", "./cli/cmd/tui/attach"))
  .command(lazy("run [message..]", "run Navi with a message", "./cli/cmd/run"))
  .command(lazy("generate", "Generate code from a prompt", "./cli/cmd/generate"))
  .command(lazy("vibe <goal>", "Run VibeMode Production Protocol", "./cli/cmd/vibe"))
  .command(lazy("debug", "Debug a command", "./cli/cmd/debug"))

  .command(lazy("account", "Manage your Navi account", "./cli/cmd/account"))
  .command(lazy("providers", "Manage AI providers", "./cli/cmd/providers"))
  .command(lazy("agent", "Manage agents", "./cli/cmd/agent"))
  .command(lazy("upgrade", "Upgrade Navi to the latest version", "./cli/cmd/upgrade"))
  .command(lazy("uninstall", "Uninstall Navi", "./cli/cmd/uninstall"))
  .command(lazy("serve", "Start the Navi server", "./cli/cmd/serve"))
  .command(lazy("web", "Start the Navi web UI", "./cli/cmd/web"))
  .command(lazy("models", "List available models", "./cli/cmd/models"))
  .command(lazy("stats", "Show token usage and cost statistics", "./cli/cmd/stats"))
  .command(lazy("export", "Export your Navi data", "./cli/cmd/export"))
  .command(lazy("import", "Import Navi data", "./cli/cmd/import"))
  .command(lazy("github", "Manage GitHub integration", "./cli/cmd/github"))
  .command(lazy("pr", "Manage pull requests", "./cli/cmd/pr"))
  .command(lazy("session", "Manage sessions", "./cli/cmd/session"))
  .command(lazy("plug", "Manage plugins", "./cli/cmd/plug"))
  .command(lazy("db", "Manage the internal database", "./cli/cmd/db"))
  .command(lazy("eval", "Evaluate prompts", "./cli/cmd/eval"))
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp("log")
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  const parse_start = performance.now()
  await cli.parse(argv)
  if (Installation.isLocal() && process.env.NAVI_PERF) {
    console.log(`Total command run (parse to end): ${Math.round(performance.now() - parse_start)}ms`)
  }
} catch (err) {
  process.stderr.write(FormatError(err) + EOL)
  process.exit(1)
}
