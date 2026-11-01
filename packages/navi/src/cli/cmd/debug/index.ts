import { Global } from "@navi-ai/core/global"
import { InstallationVersion } from "@navi-ai/core/installation/version"
import { Flag } from "@navi-ai/core/flag/flag"
import os from "os"
import { Duration, Effect } from "effect"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { deferredCommand } from "../../deferred-command"

// Every debug subcommand lives in its own module, and most of them pull the
// agent graph, the config graph, or the service runtime. They are registered by
// name/describe only, so `debug --help` lists them without importing any of them.
const subcommands = [
  deferredCommand({
    command: "config",
    describe: "show resolved configuration",
    load: () => import("./config").then((m) => m.ConfigCommand),
  }),
  deferredCommand({
    command: "lsp",
    describe: "LSP debugging utilities",
    load: () => import("./lsp").then((m) => m.LSPCommand),
  }),
  deferredCommand({
    command: "rg",
    describe: "ripgrep debugging utilities",
    load: () => import("./ripgrep").then((m) => m.RipgrepCommand),
  }),
  deferredCommand({
    command: "file",
    describe: "file system debugging utilities",
    load: () => import("./file").then((m) => m.FileCommand),
  }),
  deferredCommand({
    command: "scrap",
    describe: "list all known projects",
    load: () => import("./scrap").then((m) => m.ScrapCommand),
  }),
  deferredCommand({
    command: "skill",
    describe: "list all available skills",
    load: () => import("./skill").then((m) => m.SkillCommand),
  }),
  deferredCommand({
    command: "snapshot",
    describe: "snapshot debugging utilities",
    load: () => import("./snapshot").then((m) => m.SnapshotCommand),
  }),
  deferredCommand({
    command: "startup",
    describe: "print startup timing",
    load: () => import("./startup").then((m) => m.StartupCommand),
  }),
  deferredCommand({
    command: "agent <name>",
    describe: "show agent configuration details",
    load: () => import("./agent").then((m) => m.AgentCommand),
  }),
  deferredCommand({
    command: "info",
    describe: "show debug information",
    load: async () => InfoCommand,
  }),
  deferredCommand({
    command: "paths",
    describe: "show global paths (data, config, cache, state)",
    load: async () => PathsCommand,
  }),
  deferredCommand({
    command: "wait",
    describe: "wait indefinitely (for debugging)",
    load: async () => WaitCommand,
  }),
]

export const DebugCommand = cmd({
  command: "debug",
  describe: "debugging and troubleshooting tools",
  builder: (yargs) => yargs.command(subcommands as never).demandCommand(),
  async handler() {},
})

const WaitCommand = effectCmd({
  command: "wait",
  describe: "wait indefinitely (for debugging)",
  handler: Effect.fn("Cli.debug.wait")(function* () {
    yield* Effect.sleep(Duration.days(1))
  }),
})

const InfoCommand = effectCmd({
  command: "info",
  describe: "show debug information",
  handler: Effect.fn("Cli.debug.info")(function* () {
    // The config graph (schema + project/config discovery) is only needed here.
    const [{ Config }, { ConfigPlugin }] = yield* Effect.promise(() =>
      Promise.all([import("@/config/config"), import("@/config/plugin")]),
    )
    const config = yield* Config.Service.use((cfg) => cfg.get())
    const termProgram = process.env.TERM_PROGRAM
      ? `${process.env.TERM_PROGRAM}${process.env.TERM_PROGRAM_VERSION ? ` ${process.env.TERM_PROGRAM_VERSION}` : ""}`
      : undefined
    const terminal = [termProgram, process.env.TERM].filter((item): item is string => Boolean(item)).join(" / ")

    console.log(`navi version: ${InstallationVersion}`)
    console.log(`os: ${os.type()} ${os.release()} ${os.arch()}`)
    console.log(`terminal: ${terminal || "unknown"}`)
    console.log("plugins:")
    if (Flag.NAVI_PURE) {
      console.log("external plugins disabled (--pure)")
      return
    }
    if (!config.plugin_origins?.length) {
      console.log("none")
      return
    }
    for (const plugin of config.plugin_origins) {
      console.log(`- ${ConfigPlugin.pluginSpecifier(plugin.spec)}`)
    }
  }),
})

const PathsCommand = cmd({
  command: "paths",
  describe: "show global paths (data, config, cache, state)",
  handler() {
    for (const [key, value] of Object.entries(Global.Path)) {
      console.log(key.padEnd(10), value)
    }
  },
})
