import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { RunCommand } from "./cli/cmd/run"
import { GenerateCommand } from "./cli/cmd/generate"
import { Log } from "./util/log"
import { AuthCommand } from "./cli/cmd/auth"
import { AgentCommand } from "./cli/cmd/agent"
import { UpgradeCommand } from "./cli/cmd/upgrade"
import { UninstallCommand } from "./cli/cmd/uninstall"
import { ModelsCommand } from "./cli/cmd/models"
import { UI } from "./cli/ui"
import { Installation } from "./installation"
import { NamedError } from "@navi-ai/sdk/util/error"
import { FormatError } from "./cli/error"
import { ServeCommand } from "./cli/cmd/serve"
import { DebugCommand } from "./cli/cmd/debug"
import { CriticCommand } from "./cli/cmd/critic"
import { PlanCommand } from "./cli/cmd/plan"
import { ReviewCommand } from "./cli/cmd/review"
import { ResearchCommand } from "./cli/cmd/research"
import { SpecCommand } from "./cli/cmd/spec"
import { BrowseCommand } from "./cli/cmd/browse"
import { StatsCommand } from "./cli/cmd/stats"
import { McpCommand } from "./cli/cmd/mcp"
import { GithubCommand } from "./cli/cmd/github"
import { ExportCommand } from "./cli/cmd/export"
import { ImportCommand } from "./cli/cmd/import"
import { AttachCommand } from "./cli/cmd/tui/attach"
import { TuiThreadCommand } from "./cli/cmd/tui/thread"
import { AcpCommand } from "./cli/cmd/acp"
import { EOL } from "os"
import { WebCommand } from "./cli/cmd/web"
import { PrCommand } from "./cli/cmd/pr"
import { SessionCommand } from "./cli/cmd/session"
import { HistoryCommand } from "./cli/cmd/history"
import { TraceCommand } from "./cli/cmd/trace"
import { CheckpointCommand } from "./cli/cmd/checkpoint"
import { Global } from "./global"
import { InitCommand } from "./cli/cmd/init"
import { RustCommand } from "./cli/cmd/rust"
import { EvalCommand } from "./cli/cmd/eval"
import { HealthCommand } from "./cli/cmd/health"
import { KnowledgeCommand } from "./cli/cmd/knowledge"

import { Registry as AgentRegistry } from "./agent/registry"
import { Learning } from "./agent/learning"
import { MemoryMonitor } from "./agent/memory-monitor"
import { Snapshot } from "./snapshot"
import { Truncate } from "./tool/truncation"
import "./agent/roles/index" // Register programmatic agent roles
import { PeersCommand } from "./cli/cmd/peers"
import { CollabCommand } from "./cli/cmd/collab"

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

const cli = yargs(hideBin(process.argv))
  .parserConfiguration({ "populate--": true })
  .scriptName("navi")
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
  .middleware(async (opts) => {
    await Global.init()
    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })
    await AgentRegistry.initialize()
    await Learning.initialize()

    Truncate.init()

    MemoryMonitor.start()

    process.env.AGENT = "1"
    process.env.navi = "1"

    Log.Default.info("navi", {
      version: Installation.VERSION,
      args: process.argv.slice(2),
    })
  })
  .usage("\n" + UI.logo())
  .completion("completion", "generate shell completion script")
  .command(AcpCommand)
  .command(McpCommand)
  .command(TuiThreadCommand)
  .command(AttachCommand)
  .command(RunCommand)
  .command({
    command: "$0 [message..]",
    describe: "run navi with a message",
    builder: (yargs: any) => {
      return (RunCommand.builder as any)(yargs).positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
    },
    handler: async (args: any) => {
      // Filter out empty strings or non-string junk
      const messageArgs = (args.message || []).filter((m: any) => typeof m === "string" && m.trim().length > 0)
      const hasMessage = messageArgs.length > 0
      const hasCommand = !!args.command

      // Always open TUI if no message or command is provided (simple, reliable logic)
      const shouldOpenTui = !hasMessage && !hasCommand

      if (shouldOpenTui) {
        Log.Default.info("Calling TuiThreadCommand.handler")
        return TuiThreadCommand.handler(args)
      }

      Log.Default.info("Calling RunCommand.handler")
      return RunCommand.handler(args)
    },
  })
  .command(GenerateCommand)
  .command(DebugCommand)
  .command(CriticCommand)
  .command(PlanCommand)
  .command(ReviewCommand)
  .command(ResearchCommand)
  .command(SpecCommand)
  .command(BrowseCommand)
  .command(AuthCommand)
  .command(AgentCommand)
  .command(UpgradeCommand)
  .command(UninstallCommand)
  .command(ServeCommand)
  .command(WebCommand)
  .command(ModelsCommand)
  .command(StatsCommand)
  .command(ExportCommand)
  .command(ImportCommand)
  .command(GithubCommand)
  .command(PrCommand)
  .command(SessionCommand)
  .command(HistoryCommand)
  .command(TraceCommand)
  .command(CheckpointCommand)
  .command(RustCommand)
  .command(EvalCommand)
  .command(HealthCommand)
  .command(KnowledgeCommand)
  .command(InitCommand)
  .command(PeersCommand)
  .command(CollabCommand)
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
  await cli.parseAsync()
} catch (e) {
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

  /*
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
  */
  Log.Default.error("fatal", data)
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
    console.error(e instanceof Error ? e.message : String(e))
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses, but only for non-TUI commands
  // to allow the TUI to clean up the terminal properly.
  const isTui = process.argv.some(arg => arg === "tui" || arg === "attach")
  const isDefaultCommand = !process.argv.slice(2).some(arg => !arg.startsWith("-"))

  if (!isTui && !isDefaultCommand) {
    process.exit()
  }
}
