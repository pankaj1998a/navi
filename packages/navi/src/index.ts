import yargs from "yargs"
import type { CommandModule } from "yargs"
import { hideBin } from "yargs/helpers"
import { commandUsesAppRuntimeDirectly, deferredCommand } from "./cli/deferred-command"
import { appRuntimeLoaded, loadAppRuntime } from "./cli/app-runtime"
import type { Log as LogNamespace } from "@navi-ai/core/util/log"
import { UI } from "./cli/ui"
import { InstallationVersion } from "@navi-ai/core/installation/version"
import { NamedError } from "@navi-ai/core/util/error"
import { EOL } from "os"
import path from "path"
import type { JsonMigration as JsonMigrationModule } from "./storage/json-migration"
import { errorMessage } from "./util/error"
import { ensureProcessMetadata } from "@navi-ai/core/util/navi-process"

const processMetadata = ensureProcessMetadata("main")

// Only the modules needed to render `--help`/`--version` are imported eagerly.
// Logging, the logger/file layer, the service runtime, and the DB migration are
// loaded on demand (process-wide crash handlers or the command middleware).

/** Log from a process-level handler without paying the logger import at startup. */
function logAsync(event: string, data: Record<string, unknown>) {
  void import("@navi-ai/core/util/log").then(({ Log }) => Log.Default.error(event, data))
}

process.on("unhandledRejection", (e) => {
  logAsync("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", (e) => {
  logAsync("exception", {
    e: errorMessage(e),
  })
})

const args = hideBin(process.argv)

// yargs applies global middleware even when it is only going to print help or
// the version, so guard the expensive setup (logging, heap monitor, one-time DB
// migration) behind this flag: `--help`/`--version` must stay off the service graph.
const helpOrVersion = args.some((arg) => ["-h", "--help", "-v", "--version"].includes(arg))

/**
 * Commands that keep running after their handler starts (servers, interactive
 * clients). They own their lifecycle and must never be force-exited by the
 * one-shot shutdown watchdog — e.g. `serve` blocks on `Effect.never`, so its
 * teardown path only runs when the server is already stopping.
 */
const LONG_LIVED_COMMANDS = new Set(["serve", "web", "acp", "attach"])

/** Command resolved from yargs; `undefined` for `--help`/`--version`. */
let command: string | undefined

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("navi ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text)
    return
  }
  process.stderr.write(out)
}

// Default command. yargs does not await async default builders, so its builder
// stays synchronous; the option set is mirrored from
// `src/cli/cmd/tui/thread.ts` (`TuiThreadCommand.builder`) to avoid importing
// that module (TuiConfig/Config, ~1.2s) just to render help. Keep both in sync.
// The implementation itself is still imported lazily by the handler.
const TuiCommand: CommandModule = {
  command: "$0 [project]",
  describe: "start navi tui",
  builder: (yargs) =>
    yargs
      .options({
        port: { type: "number", describe: "port to listen on", default: 0 },
        hostname: { type: "string", describe: "hostname to listen on", default: "127.0.0.1" },
        mdns: {
          type: "boolean",
          describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
          default: false,
        },
        "mdns-domain": {
          type: "string",
          describe: "custom domain name for mDNS service (default: navi.local)",
          default: "navi.local",
        },
        cors: { type: "string", array: true, describe: "additional domains to allow for CORS", default: [] },
      })
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
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => (await import("./cli/cmd/tui/thread")).TuiThreadCommand.handler(args as never),
}

// Command implementations are imported lazily: yargs only needs name/describe at
// registration time, so `--help`/`--version` no longer pay for the command graph
// (which transitively pulls the 55-service AppRuntime through effect-cmd).
const commands = [
  deferredCommand({
    command: "acp",
    describe: "start ACP (Agent Client Protocol) server",
    load: () => import("./cli/cmd/acp").then((m) => m.AcpCommand),
  }),
  deferredCommand({
    command: "mcp",
    describe: "manage MCP (Model Context Protocol) servers",
    load: () => import("./cli/cmd/mcp").then((m) => m.McpCommand),
  }),
  // Default command ($0): see TuiCommand above.
  TuiCommand,
  deferredCommand({
    command: "attach <url>",
    describe: "attach to a running navi server",
    load: () => import("./cli/cmd/tui/attach").then((m) => m.AttachCommand),
  }),
  deferredCommand({
    command: "run [message..]",
    describe: "run navi with a message",
    load: () => import("./cli/cmd/run").then((m) => m.RunCommand),
  }),
  deferredCommand({
    command: "review",
    describe: "review code changes with a headless agent session",
    load: () => import("./cli/cmd/review").then((m) => m.ReviewCommand),
  }),
  deferredCommand({
    command: "generate",
    describe: false,
    load: () => import("./cli/cmd/generate").then((m) => m.GenerateCommand),
  }),
  deferredCommand({
    command: "debug",
    describe: "debugging and troubleshooting tools",
    load: () => import("./cli/cmd/debug").then((m) => m.DebugCommand),
  }),
  deferredCommand({
    command: "console",
    describe: false,
    load: () => import("./cli/cmd/account").then((m) => m.ConsoleCommand),
  }),
  deferredCommand({
    command: "providers",
    aliases: ["auth"],
    describe: "manage AI providers and credentials",
    load: () => import("./cli/cmd/providers").then((m) => m.ProvidersCommand),
  }),
  deferredCommand({
    command: "agent",
    describe: "manage agents",
    load: () => import("./cli/cmd/agent").then((m) => m.AgentCommand),
  }),
  deferredCommand({
    command: "upgrade [target]",
    describe: "upgrade navi to the latest or a specific version",
    load: () => import("./cli/cmd/upgrade").then((m) => m.UpgradeCommand),
  }),
  deferredCommand({
    command: "uninstall",
    describe: "uninstall navi and remove all related files",
    load: () => import("./cli/cmd/uninstall").then((m) => m.UninstallCommand),
  }),
  deferredCommand({
    command: "serve",
    describe: "starts a headless navi server",
    load: () => import("./cli/cmd/serve").then((m) => m.ServeCommand),
  }),
  deferredCommand({
    command: "web",
    describe: "start navi server and open web interface",
    load: () => import("./cli/cmd/web").then((m) => m.WebCommand),
  }),
  deferredCommand({
    command: "browser <action> [target]",
    describe:
      "Headless Chrome DevTools CLI (check, open, content, scrape, screenshot, eval, console, network, pick)",
    load: () => import("./cli/cmd/browser").then((m) => m.BrowserCommand),
  }),
  deferredCommand({
    command: "structure [target]",
    describe: "Compress TypeScript, Swift, Python, Go, and Rust projects into dense AST symbol maps for LLM agents",
    load: () => import("./cli/cmd/structure").then((m) => m.StructureCommand),
  }),
  deferredCommand({
    command: "agentation <action> [id]",
    describe: "Inspect and manage live Agentation visual annotations (status, pending, resolve)",
    load: () => import("./cli/cmd/agentation").then((m) => m.AgentationCommand),
  }),
  deferredCommand({
    command: "trash <paths..>",
    describe: "Safely move files or directories to system Trash instead of permanent rm -rf",
    load: () => import("./cli/cmd/trash").then((m) => m.TrashCommand),
  }),
  deferredCommand({
    command: "models [provider]",
    describe: "list all available models",
    load: () => import("./cli/cmd/models").then((m) => m.ModelsCommand),
  }),
  deferredCommand({
    command: "stats",
    describe: "show token usage and cost statistics",
    load: () => import("./cli/cmd/stats").then((m) => m.StatsCommand),
  }),
  deferredCommand({
    command: "export [sessionID]",
    describe: "export session data as JSON",
    load: () => import("./cli/cmd/export").then((m) => m.ExportCommand),
  }),
  deferredCommand({
    command: "import <file>",
    describe: "import session data from JSON file or URL",
    load: () => import("./cli/cmd/import").then((m) => m.ImportCommand),
  }),
  deferredCommand({
    command: "github",
    describe: "manage GitHub agent",
    load: () => import("./cli/cmd/github").then((m) => m.GithubCommand),
  }),
  deferredCommand({
    command: "pr <number>",
    describe: "fetch and checkout a GitHub PR branch, then run navi",
    load: () => import("./cli/cmd/pr").then((m) => m.PrCommand),
  }),
  deferredCommand({
    command: "session",
    describe: "manage sessions",
    load: () => import("./cli/cmd/session").then((m) => m.SessionCommand),
  }),
  deferredCommand({
    command: "plugin <module>",
    aliases: ["plug"],
    describe: "install plugin and update config",
    load: () => import("./cli/cmd/plug").then((m) => m.PluginCommand),
  }),
  deferredCommand({
    command: "db",
    describe: "database tools",
    load: () => import("./cli/cmd/db").then((m) => m.DbCommand),
  }),
  deferredCommand({
    command: "memory <command>",
    describe: "inspect, search, and manage Navi durable memory, handoffs, and wiki",
    load: () => import("./cli/cmd/memory").then((m) => m.MemoryCommand),
  }),
  deferredCommand({
    command: "agency [action] [arg]",
    describe: "Interact with The Agency's 282 AI specialists and NEXUS multi-agent pipeline",
    load: () => import("./cli/cmd/agency").then((m) => m.AgencyCommand),
  }),
  deferredCommand({
    command: "audit [action]",
    describe: "Run Cloudflare-style structured security audit (6-phase coverage, validation, and reporting)",
    load: () => import("./cli/cmd/audit").then((m) => m.AuditCommand),
  }),
  deferredCommand({
    command: "pentest",
    describe: "run autonomous security penetration test on target codebase or web application",
    load: () => import("./cli/cmd/pentest").then((m) => m.PentestCommand),
  }),
  deferredCommand({
    command: "graph [action] [arg1] [arg2]",
    describe: "Codebase Knowledge Graph & Architecture Intelligence (Graphify Engine)",
    load: () => import("./cli/cmd/graph").then((m) => m.GraphCommand),
  }),
  deferredCommand({
    command: "headroom [action] [arg]",
    describe: "Headroom AI — Context Compression Layer & Lossless CCR Store",
    load: () => import("./cli/cmd/headroom").then((m) => m.HeadroomCommand),
  }),
  deferredCommand({
    command: "recipe [action] [target]",
    describe: "Manage and run deterministic AI workflow recipes (Goose-style structured automation)",
    load: () => import("./cli/cmd/recipe").then((m) => m.RecipeCommand),
  }),
    deferredCommand({
    command: "bridge [action]",
    describe: "Zero-API-key browser AI bridge daemon & remote MCP tunnel (status, start, doctor, token, install, tunnel)",
    load: () => import("./cli/cmd/bridge").then((m) => m.BridgeCommand),
  }),
  deferredCommand({
    command: "ask <prompt..>",
    describe: "Zero-API-key query to logged-in web AI (ChatGPT, Claude, DeepSeek, Gemini) with optional file editing",
    load: () => import("./cli/cmd/ask").then((m) => m.AskCommand),
  }),
  deferredCommand({
    command: "api <method> <path>",
    describe: "make a request to a running navi server",
    load: () => import("./cli/cmd/api").then((m) => m.ApiCommand),
  }),
  deferredCommand({
    command: "doctor [action]",
    describe: "Diagnose system health, native Rust bindings, AI providers, and environment (Goose-style /doctor)",
    load: () => import("./cli/cmd/doctor").then((m) => m.DoctorCommand),
  }),
]

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("navi")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
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
    if (helpOrVersion) return

    if (opts.pure) {
      process.env.NAVI_PURE = "1"
    }

    // Deferred: `effect`, the http client, and the v8 heap monitor are only
    // needed once a command actually runs (never for `--help`/`--version`).
    const [{ Installation }, { Heap }, { Log }, { Filesystem }, { Global }] = await Promise.all([
      import("./installation"),
      import("./cli/heap"),
      import("@navi-ai/core/util/log"),
      import("./util/filesystem"),
      import("@navi-ai/core/global"),
    ])

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as LogNamespace.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    Heap.start()

    process.env.AGENT = "1"
    process.env.NAVI = "1"
    process.env.NAVI_PID = String(process.pid)

    Log.Default.info("navi", {
      version: InstallationVersion,
      args: process.argv.slice(2),
      process_role: processMetadata.processRole,
      run_id: processMetadata.runID,
    })

    const marker = path.join(Global.Path.data, "navi.db")
    if (!(await Filesystem.exists(marker))) {
      const tty = process.stderr.isTTY
      process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
      const width = 36
      const orange = "\x1b[38;5;214m"
      const muted = "\x1b[0;2m"
      const reset = "\x1b[0m"
      let last = -1
      if (tty) process.stderr.write("\x1b[?25l")
      try {
        const [{ JsonMigration }, { Database }, { drizzle }] = await Promise.all([
          import("./storage/json-migration"),
          import("./storage/db"),
          import("drizzle-orm/bun-sqlite"),
        ])
        await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
          progress: (event: JsonMigrationModule.Progress) => {
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
      process.stderr.write("Database migration complete." + EOL)
    }
  })
  .usage("")
  .completion("completion", "generate shell completion script")

for (const command of commands) cli.command(command as never)

cli
  .fail((msg, err) => {
    process.stderr.write("YARGS_FAIL_MSG: " + msg + "\n")
    if (err) process.stderr.write("YARGS_FAIL_ERR: " + (err.stack || err) + "\n")
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    const parsed = await cli.parse(args)
    const first = parsed?._?.[0]
    command = typeof first === "string" ? first : undefined
  }
} catch (e) {
  const [{ Log }, { FormatError }] = await Promise.all([import("@navi-ai/core/util/log"), import("./cli/error")])
  let data: Record<string, any> = {}
  if (e instanceof NamedError) {
    const obj = e.toObject()
    Object.assign(data, {
      ...obj.data,
    })
  }

  if (e instanceof Error) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      cause: e.cause?.toString(),
      stack: e.stack,
    })
  }

  if (e instanceof ResolveMessage) {
    Object.assign(data, {
      name: e.name,
      message: e.message,
      code: e.code,
      specifier: e.specifier,
      referrer: e.referrer,
      position: e.position,
      importKind: e.importKind,
    })
  }
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
} finally {
  process.exitCode ??= 0
  const usedRuntime = appRuntimeLoaded() || commandUsesAppRuntimeDirectly()
  // One-shot CLI commands arm the forced-shutdown watchdog here, from the
  // entry/teardown path — never from an InstanceStore layer finalizer, so an
  // embedder that disposes the runtime mid-life keeps running. Long-lived
  // commands own their lifecycle and are never force-exited by this process.
  const oneShot = usedRuntime && !LONG_LIVED_COMMANDS.has(command ?? "")
  const watchdog = oneShot ? await import("./effect/instance-registry") : undefined
  // Safety net while teardown runs: a wedged finalizer (dockerd-backed MCP
  // server, LSP shutdown) must not hang a one-shot CLI forever.
  const disarm = watchdog?.scheduleShutdownExit(watchdog.disposeTimeoutMs() + watchdog.shutdownTimeoutMs())
  // Only dispose when a handler actually loaded the runtime: importing it here
  // unconditionally cost ~5s on every `--help`/`--version`/light command.
  if (usedRuntime) {
    try {
      const { AppRuntime } = await loadAppRuntime()
      await AppRuntime.dispose()
    } catch {
      // Ignore disposal errors during shutdown; nothing left to route them to
    }
  }
  // Disposal is done: shorten the grace so leftover handles (native watchers,
  // detached fibers) cannot keep the process resident. The forced exit drains
  // stdio first; grace is NAVI_SHUTDOWN_TIMEOUT_MS (default 3s, clamped
  // 500ms..30s).
  if (watchdog) {
    disarm?.()
    watchdog.scheduleShutdownExit()
  }
}
