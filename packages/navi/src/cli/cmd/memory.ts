import type { Argv } from "yargs"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Effect } from "effect"
import { Memory } from "@/memory"
import { AppRuntime } from "@/effect/app-runtime"
import { EOL } from "os"

const SearchSubcommand = cmd({
  command: "search <query>",
  describe: "search durable memory, wiki pages, and observations",
  builder: (yargs: Argv) =>
    yargs
      .positional("query", { type: "string", describe: "search query terms", demandOption: true })
      .option("scope", { type: "string", describe: "scope filter (global, projects, sessions)" })
      .option("scope-id", { type: "string", describe: "scope id filter" })
      .option("type", { type: "string", describe: "type filter (topic, observation, wiki, cc)" })
      .option("limit", { type: "number", default: 10, describe: "maximum results to return" }),
  handler: async (args: { query: string; scope?: string; scopeId?: string; type?: string; limit: number }) => {
    const program = Effect.gen(function* () {
      const memory = yield* Memory.Service
      return yield* memory.search({
        query: args.query,
        scope: args.scope,
        scope_id: args.scopeId,
        type: args.type,
        limit: args.limit,
      })
    })

    const results = await AppRuntime.runPromise(program.pipe(Effect.provide(Memory.defaultLayer)))
    if (results.length === 0) {
      UI.println("No matching memory entries found.")
      return
    }

    UI.println(`Found ${results.length} result(s):` + EOL)
    for (const res of results) {
      UI.println(`• [${res.type}] (${res.scope}/${res.scope_id}) ${res.path}`)
      UI.println(`  Score: ${res.score.toFixed(3)}`)
      UI.println(`  Snippet: ${res.snippet.trim()}` + EOL)
    }
  },
})

const HandoffSubcommand = cmd({
  command: "handoff",
  describe: "manage cross-agent handoffs",
  builder: (yargs: Argv) =>
    yargs
      .option("status", {
        type: "string",
        choices: ["open", "claimed", "expired", "cancelled", "all"] as const,
        default: "open",
        describe: "filter by status",
      })
      .option("accept", { type: "string", describe: "handoff ID to claim and accept" })
      .option("cancel", { type: "string", describe: "handoff ID to cancel" })
      .option("dir", { type: "string", describe: "target directory to query for" }),
  handler: async (args: { status: string; accept?: string; cancel?: string; dir?: string }) => {
    const program = Effect.gen(function* () {
      const memory = yield* Memory.Service
      if (args.accept) {
        const res = yield* memory.acceptHandoff({
          handoff_id: args.accept,
          target_directory: args.dir || process.cwd(),
        })
        return { action: "accept", res }
      }
      if (args.cancel) {
        const ok = yield* memory.cancelHandoff(args.cancel)
        return { action: "cancel", success: ok }
      }
      const list = yield* memory.listHandoffs({
        target_directory: args.dir,
        status: args.status as any,
      })
      return { action: "list", list }
    })

    const result = await AppRuntime.runPromise(program.pipe(Effect.provide(Memory.defaultLayer)))
    if (result.action === "accept") {
      const res = result.res!
      if (res.status === "claimed" && res.handoff) {
        UI.println(`Successfully claimed handoff ${res.handoff.id}:`)
        UI.println(`Summary: ${res.handoff.summary}`)
        if (res.handoff.next_steps.length > 0) {
          UI.println(`Next Steps:\n${res.handoff.next_steps.map((s) => `  - ${s}`).join("\n")}`)
        }
      } else {
        UI.println(`Failed to claim handoff: ${res.reason ?? res.status}`)
      }
    } else if (result.action === "cancel") {
      UI.println(result.success ? "Handoff cancelled successfully." : "Handoff could not be cancelled.")
    } else {
      const list = result.list!
      if (list.length === 0) {
        UI.println(`No handoffs found with status: ${args.status}`)
        return
      }
      UI.println(`Handoffs (${list.length}):` + EOL)
      for (const h of list) {
        UI.println(`[${h.id}] status=${h.status} owner=${h.owner} created=${h.created_at}`)
        UI.println(`  Directory: ${h.target_directory}`)
        UI.println(`  Summary: ${h.summary}` + EOL)
      }
    }
  },
})

const LintSubcommand = cmd({
  command: "lint",
  describe: "lint wiki documentation for decay, broken links, or syntax issues",
  handler: async () => {
    const program = Effect.gen(function* () {
      const memory = yield* Memory.Service
      return yield* memory.lintWiki()
    })

    const result = await AppRuntime.runPromise(program.pipe(Effect.provide(Memory.defaultLayer)))
    if (result.healthy) {
      UI.println("✓ Memory Wiki is healthy. No issues detected.")
    } else {
      UI.println(`Found ${result.issues.length} wiki issue(s):` + EOL)
      for (const issue of result.issues) {
        UI.println(`[${issue.severity.toUpperCase()}] ${issue.path}: ${issue.issue} (${issue.recommendation})`)
      }
    }
  },
})

const ProfileSubcommand = cmd({
  command: "profile",
  describe: "inspect or update developer habits and preferences profile",
  builder: (yargs: Argv) =>
    yargs
      .option("set-pm", {
        type: "string",
        choices: ["npm", "pnpm", "yarn", "bun"] as const,
        describe: "set preferred package manager",
      })
      .option("set-test-runner", {
        type: "string",
        describe: "set preferred test runner command",
      }),
  handler: async (args: { setPm?: "npm" | "pnpm" | "yarn" | "bun"; setTestRunner?: string }) => {
    const program = Effect.gen(function* () {
      const memory = yield* Memory.Service
      if (args.setPm || args.setTestRunner) {
        return yield* memory.updateUserProfile({
          package_manager: args.setPm,
          preferred_test_runner: args.setTestRunner,
        })
      }
      return yield* memory.getUserProfile()
    })

    const profile = await AppRuntime.runPromise(program.pipe(Effect.provide(Memory.defaultLayer)))
    UI.println("Developer Memory Profile:" + EOL)
    UI.println(JSON.stringify(profile, null, 2))
  },
})

const StatusSubcommand = cmd({
  command: "status",
  describe: "show memory subsystem statistics and storage footprint",
  handler: async () => {
    const program = Effect.gen(function* () {
      const memory = yield* Memory.Service
      const pages = yield* memory.listWikiPages()
      const handoffs = yield* memory.listHandoffs({ status: "all" })
      const root = yield* memory.root()
      const profile = yield* memory.getUserProfile()
      return { pagesCount: pages.length, handoffsCount: handoffs.length, root, profile }
    })

    const stat = await AppRuntime.runPromise(program.pipe(Effect.provide(Memory.defaultLayer)))
    UI.println("Navi Memory Subsystem Status:" + EOL)
    UI.println(`• Storage Root: ${stat.root}`)
    UI.println(`• Wiki Pages: ${stat.pagesCount}`)
    UI.println(`• Registered Handoffs: ${stat.handoffsCount}`)
    UI.println(`• Custom Profile Rules: ${stat.profile.custom_rules.length}`)
  },
})

export const MemoryCommand = cmd({
  command: "memory <command>",
  describe: "inspect, search, and manage Navi durable memory, handoffs, and wiki",
  builder: (yargs: Argv) =>
    yargs
      .command(SearchSubcommand)
      .command(HandoffSubcommand)
      .command(LintSubcommand)
      .command(ProfileSubcommand)
      .command(StatusSubcommand)
      .demandCommand(1, "Please provide a valid memory subcommand."),
  handler: () => {},
})
