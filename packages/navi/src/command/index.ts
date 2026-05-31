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
import { MCP } from "../mcp"
import { Skill } from "../skill"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_TELEPORT from "./template/teleport.txt"
import PROMPT_GITHUB_PR_REVIEW from "./template/github_pr_review.txt"
import PROMPT_GITHUB_ISSUE_TRIAGE from "./template/github_issue_triage.txt"
import PROMPT_RELEASE_NOTES from "./template/release_notes.txt"

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
        description: "review changes [commit|branch|pr], defaults to uncommitted",
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
        description: "Complete a specialized GitHub PR review",
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

      return {
        commands,
      }
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.commands[name]
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
