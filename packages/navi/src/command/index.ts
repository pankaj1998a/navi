import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, Context, Schema } from "effect"
import z from "zod"
import { zod, ZodOverride } from "@navi-ai/core/effect-zod"
import { withStatics } from "@navi-ai/core/schema"
import { Config } from "@/config/config"
import { Flag } from "@navi-ai/core/flag/flag"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_TELEPORT from "./template/teleport.txt"
import PROMPT_GITHUB_PR_REVIEW from "./template/github_pr_review.txt"
import PROMPT_GITHUB_ISSUE_TRIAGE from "./template/github_issue_triage.txt"
import PROMPT_RELEASE_NOTES from "./template/release_notes.txt"
import PROMPT_KARPATHY_LOOP from "./template/karpathy_loop.txt"
import PROMPT_GOAL from "./template/goal.txt"
import PROMPT_GRILL_ME from "./template/grill_me.txt"
import PROMPT_LEARN from "./template/learn.txt"
import PROMPT_SCHEDULE from "./template/schedule.txt"
import PROMPT_COST from "./template/cost.txt"
import PROMPT_CHECKPOINT from "./template/checkpoint.txt"
import PROMPT_DIFF from "./template/diff.txt"
import PROMPT_DOCTOR from "./template/doctor.txt"
import PROMPT_RECAP from "./template/recap.txt"
import PROMPT_WATCH_UI from "./template/watch_ui.txt"
import PROMPT_AGENTATION from "./template/agentation.txt"
import PROMPT_ACCEPTPR from "./template/acceptpr.txt"
import PROMPT_LANDPR from "./template/landpr.txt"
import PROMPT_FIXISSUE from "./template/fixissue.txt"
import PROMPT_HANDOFF from "./template/handoff.txt"
import PROMPT_PICKUP from "./template/pickup.txt"
import PROMPT_RAISE from "./template/raise.txt"
import PROMPT_SECTRIAGE from "./template/sectriage.txt"
import PROMPT_BRIDGE from "./template/bridge.txt"
import PROMPT_ASK from "./template/ask.txt"

type State = {
  commands: Record<string, Info>
}

export const Event = {
  Executed: BusEvent.define(
    "command.executed",
    Schema.Struct({
      name: Schema.String,
      sessionID: SessionID,
      arguments: Schema.String,
      messageID: MessageID,
    }),
  ),
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown.annotate({ [ZodOverride]: z.promise(z.string()).or(z.string()) }),
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
})
  .annotate({ identifier: "Command" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))

// for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & { template: Promise<string> | string }

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
} as const

export const COMMAND_ALIASES: Record<string, string> = {
  grill: "grill-me",
  "karpathy-loop": "loop",
  "to-spec": "spec",
  "code-simplify": "code-simplifier",
  "pr-review": "review-pr",
  "git-diff": "diff",
  summarize: "compact",
  tdd: "tdd-build",
  presentation: "ppt",
  careful: "guard",
  "qa-only": "qa",
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@navi/Command") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const commands: Record<string, Info> = {}

      commands[Default.INIT] = {
        name: Default.INIT,
        description: "guided AGENTS.md setup",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      }
      commands[Default.REVIEW] = {
        name: Default.REVIEW,
        description: "Review local git changes [commit|branch|pr], defaults to uncommitted diff",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", ctx.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      }
      commands["forge"] = {
        name: "forge",
        description: "Structured waterfall forge for complex systems",
        source: "command",
        agent: "architect",
        get template() {
          return "FORGE: $ARGUMENTS"
        },
        hints: ["$ARGUMENTS"],
      }
      commands["teleport"] = {
        name: "teleport",
        description: "Export this session to a portable archive",
        source: "command",
        get template() {
          return PROMPT_TELEPORT.replace("$ARGUMENTS", "")
        },
        hints: ["$ARGUMENTS"],
      }
      commands["github-pr-review"] = {
        name: "github-pr-review",
        description: "Specialized GitHub PR review via github-reviewer agent (see also /review-pr)",
        source: "command",
        agent: "github-reviewer",
        get template() {
          return PROMPT_GITHUB_PR_REVIEW
        },
        hints: hints(PROMPT_GITHUB_PR_REVIEW),
      }
      commands["github-issue-triage"] = {
        name: "github-issue-triage",
        description: "Triage GitHub issues and suggest labels",
        source: "command",
        agent: "github-triage",
        get template() {
          return PROMPT_GITHUB_ISSUE_TRIAGE
        },
        hints: hints(PROMPT_GITHUB_ISSUE_TRIAGE),
      }
      commands["release-notes"] = {
        name: "release-notes",
        description: "Generate user-friendly release notes from commits/PRs",
        source: "command",
        agent: "release-notes",
        get template() {
          return PROMPT_RELEASE_NOTES
        },
        hints: hints(PROMPT_RELEASE_NOTES),
      }
      commands["loop"] = {
        name: "loop",
        description: "Autonomous Karpathy experiment loop: hypothesize -> edit -> eval -> commit/revert (alias: /karpathy-loop)",
        source: "command",
        agent: "karpathy-loop",
        get template() {
          return PROMPT_KARPATHY_LOOP
        },
        hints: hints(PROMPT_KARPATHY_LOOP),
      }
      commands["karpathy-loop"] = {
        name: "karpathy-loop",
        description: "Autonomous Karpathy experiment loop: hypothesize -> edit -> eval -> commit/revert (canonical: /loop)",
        source: "command",
        agent: "karpathy-loop",
        get template() {
          return PROMPT_KARPATHY_LOOP
        },
        hints: hints(PROMPT_KARPATHY_LOOP),
      }
      commands["goal"] = {
        name: "goal",
        description: "High-perseverance autonomous goal execution until completion",
        source: "command",
        get template() {
          return PROMPT_GOAL
        },
        hints: hints(PROMPT_GOAL),
      }
      commands["grill-me"] = {
        name: "grill-me",
        description: "Stress-test assumptions and interview on technical tradeoffs before coding (alias: /grill)",
        source: "command",
        get template() {
          return PROMPT_GRILL_ME
        },
        hints: hints(PROMPT_GRILL_ME),
      }
      commands["learn"] = {
        name: "learn",
        description: "Extract persistent guidelines or corrections into AGENTS.md / rules",
        source: "command",
        get template() {
          return PROMPT_LEARN
        },
        hints: hints(PROMPT_LEARN),
      }
      commands["schedule"] = {
        name: "schedule",
        description: "Inspect, configure, or create scheduled background tasks and cron jobs",
        source: "command",
        get template() {
          return PROMPT_SCHEDULE
        },
        hints: hints(PROMPT_SCHEDULE),
      }
      commands["cost"] = {
        name: "cost",
        description: "Show token usage, cost accounting, and model pricing",
        source: "command",
        get template() {
          return PROMPT_COST
        },
        hints: hints(PROMPT_COST),
      }
      commands["checkpoint"] = {
        name: "checkpoint",
        description: "Create, list, or restore workspace snapshot checkpoints",
        source: "command",
        get template() {
          return PROMPT_CHECKPOINT
        },
        hints: hints(PROMPT_CHECKPOINT),
      }
      commands["rewind"] = {
        name: "rewind",
        description: "Rewind workspace to a previous checkpoint",
        source: "command",
        get template() {
          return PROMPT_CHECKPOINT
        },
        hints: hints(PROMPT_CHECKPOINT),
      }
      commands["diff"] = {
        name: "diff",
        description: "Show git status and uncommitted changes",
        source: "command",
        get template() {
          return PROMPT_DIFF
        },
        hints: hints(PROMPT_DIFF),
      }
      commands["doctor"] = {
        name: "doctor",
        description: "Run environment and workspace health diagnostics",
        source: "command",
        get template() {
          return PROMPT_DOCTOR
        },
        hints: hints(PROMPT_DOCTOR),
      }
      commands["recap"] = {
        name: "recap",
        description: "Generate a bounded 40-60 word session catch-up and next action (Codex pattern)",
        source: "command",
        get template() {
          return PROMPT_RECAP
        },
        hints: hints(PROMPT_RECAP),
      }
      commands["watch-ui"] = {
        name: "watch-ui",
        description: "Autonomous visual feedback loop: watch pending UI annotations and resolve them",
        source: "command",
        agent: "visual-reviewer",
        get template() {
          return PROMPT_WATCH_UI
        },
        hints: hints(PROMPT_WATCH_UI),
      }
      commands["agentation"] = {
        name: "agentation",
        description: "Agentation visual feedback setup and toolbar assistant",
        source: "command",
        agent: "visual-reviewer",
        get template() {
          return PROMPT_AGENTATION
        },
        hints: hints(PROMPT_AGENTATION),
      }
      commands["acceptpr"] = {
        name: "acceptpr",
        description: "Land one PR end-to-end (changelog + thanks, lint, merge, back to main)",
        source: "command",
        get template() {
          return PROMPT_ACCEPTPR
        },
        hints: hints(PROMPT_ACCEPTPR),
      }
      commands["landpr"] = {
        name: "landpr",
        description: "Land PR via temp-branch rebase, full gate, merge, and verification",
        source: "command",
        get template() {
          return PROMPT_LANDPR
        },
        hints: hints(PROMPT_LANDPR),
      }
      commands["fixissue"] = {
        name: "fixissue",
        description: "Fix an issue end-to-end (tests, changelog, commit, push, comment, close)",
        source: "command",
        get template() {
          return PROMPT_FIXISSUE
        },
        hints: hints(PROMPT_FIXISSUE),
      }
      commands["handoff"] = {
        name: "handoff",
        description: "Capture current session state for the next agent",
        source: "command",
        get template() {
          return PROMPT_HANDOFF
        },
        hints: hints(PROMPT_HANDOFF),
      }
      commands["pickup"] = {
        name: "pickup",
        description: "Rehydrate context and onboard onto active task",
        source: "command",
        get template() {
          return PROMPT_PICKUP
        },
        hints: hints(PROMPT_PICKUP),
      }
      commands["raise"] = {
        name: "raise",
        description: "Open next patch Unreleased section in CHANGELOG.md",
        source: "command",
        get template() {
          return PROMPT_RAISE
        },
        hints: hints(PROMPT_RAISE),
      }
      commands["sectriage"] = {
        name: "sectriage",
        description: "Triage GitHub Security Advisory (GHSA) end-to-end",
        source: "command",
        get template() {
          return PROMPT_SECTRIAGE
        },
        hints: hints(PROMPT_SECTRIAGE),
      }

      commands["bridge"] = {
        name: "bridge",
        description: "Zero-API-key browser AI bridge daemon & queries (start, status, doctor, tunnel, query)",
        source: "command",
        get template() {
          return PROMPT_BRIDGE
        },
        hints: hints(PROMPT_BRIDGE),
      }
      commands["ask"] = {
        name: "ask",
        description: "Zero-API-key query to browser AI (ChatGPT, Claude, DeepSeek-R1, Gemini)",
        source: "command",
        get template() {
          return PROMPT_ASK
        },
        hints: hints(PROMPT_ASK),
      }
      if (!Flag.NAVI_DISABLE_DEFAULT_PLUGINS) {
        const { getOfficialCommands } = yield* Effect.promise(() => import("@/plugin/official"))
        Object.assign(commands, getOfficialCommands())
      }

      commands["plan"] = {
        name: "plan",
        agent: "plan",
        description: "Switch to and run in Plan mode (read-only analysis, research, and planning)",
        source: "command",
        get template() {
          return "$ARGUMENTS"
        },
        hints: ["$ARGUMENTS"],
      }
      commands["build"] = {
        name: "build",
        agent: "build",
        description: "Switch to and run in Build mode (full implementation and tool execution)",
        source: "command",
        get template() {
          return "$ARGUMENTS"
        },
        hints: ["$ARGUMENTS"],
      }
      commands["permissions"] = {
        name: "permissions",
        description: "Configure 4-tier permission mode: supervised | auto_accept_edits | auto | full_access",
        source: "command",
        get template() {
          return "Configure permission mode: $ARGUMENTS"
        },
        hints: ["supervised", "auto_accept_edits", "auto", "full_access"],
      }
      commands["swarm"] = {
        name: "swarm",
        description: "Fan out a coordinated teammate swarm on an objective",
        source: "command",
        get template() {
          return "Mobilize teammate swarm for objective: $ARGUMENTS"
        },
        hints: ["$ARGUMENTS"],
      }
      commands["magicdocs"] = {
        name: "magicdocs",
        description: "Audit and update living architecture documentation and memory",
        source: "command",
        get template() {
          return "Audit and distill living documentation: $ARGUMENTS"
        },
        hints: ["architecture", "changelog", "memory"],
      }

      for (const [name, command] of Object.entries(cfg.command ?? {})) {
        commands[name] = {
          name,
          agent: command.agent,
          model: command.model,
          description: command.description,
          source: "command",
          get template() {
            return command.template
          },
          subtask: command.subtask,
          hints: hints(command.template),
        }
      }

      for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
        commands[name] = {
          name,
          source: "mcp",
          description: prompt.description,
          get template() {
            return bridge.promise(
              mcp
                .getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                )
                .pipe(
                  Effect.map(
                    (template) =>
                      template?.messages
                        .map((message) => (message.content.type === "text" ? message.content.text : ""))
                        .join("\n") || "",
                  ),
                ),
            )
          },
          hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
        }
      }

      for (const item of yield* skill.all()) {
        if (commands[item.name]) continue
        commands[item.name] = {
          name: item.name,
          description: item.description,
          source: "skill",
          get template() {
            return item.content
          },
          hints: [],
        }
      }

      for (const [alias, canonical] of Object.entries(COMMAND_ALIASES)) {
        if (!commands[alias] && commands[canonical]) {
          commands[alias] = {
            ...commands[canonical],
            name: alias,
            description: commands[canonical].description
              ? `${commands[canonical].description} (alias of /${canonical})`
              : `Alias of /${canonical}`,
          }
        }
      }

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      const direct = s.commands[name]
      if (direct) return direct
      const canonical = COMMAND_ALIASES[name]
      if (canonical) return s.commands[canonical]
      return undefined
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.commands)
    })

    return Service.of({ get, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export * as Command from "."
