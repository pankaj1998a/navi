import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { Log } from "../util/log"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_COST from "./template/cost.txt"
import PROMPT_TELEPORT from "./template/teleport.txt"
import PROMPT_SUBAGENT_SELECT from "./template/agent.txt"
import PROMPT_AGENTS from "./template/agents.txt"
import PROMPT_GITHUB_PR_REVIEW from "./template/github_pr_review.txt"
import PROMPT_GITHUB_ISSUE_TRIAGE from "./template/github_issue_triage.txt"
import PROMPT_RELEASE_NOTES from "./template/release_notes.txt"

export namespace Command {
  const log = Log.create({ service: "command" })

  type State = {
    commands: Record<string, Info>
  }

  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

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
    FORGE: "forge",
    TELEPORT: "teleport",
    AGENT: "agent",
  } as const

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly list: () => Effect.Effect<Info[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@navi/Command") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const mcp = yield* MCP.Service
      const skill = yield* Skill.Service

      const init = Effect.fn("Command.state")(function* (ctx) {
        const cfg = yield* config.get()
        const commands: Record<string, Info> = {}

        commands[Default.INIT] = {
          name: Default.INIT,
          description: "create/update AGENTS.md",
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
        commands[Default.FORGE] = {
          name: Default.FORGE,
          description: "Structured waterfall forge for complex systems",
          source: "command",
          agent: "architect",
          get template() {
            return "FORGE: $ARGUMENTS" // The orchestrator will intercept this or the architect will handle it.
          },
          hints: ["$ARGUMENTS"],
        }
        commands[Default.TELEPORT] = {
          name: Default.TELEPORT,
          description: "Export this session to a portable archive",
          source: "command",
          get template() {
            return PROMPT_TELEPORT.replace("$ARGUMENTS", "")
          },
          hints: ["$ARGUMENTS"],
        }
        commands[Default.AGENT] = {
          name: Default.AGENT,
          description: "Comprehensive multi-step model configuration for ALL sub-agents",
          source: "command",
          get template() {
            return PROMPT_SUBAGENT_SELECT
          },
          hints: hints(PROMPT_SUBAGENT_SELECT),
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
              return new Promise<string>(async (resolve, reject) => {
                const template = await MCP.getPrompt(
                  prompt.client,
                  prompt.name,
                  prompt.arguments
                    ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                    : {},
                ).catch(reject)
                resolve(
                  template?.messages
                    .map((message) => (message.content.type === "text" ? message.content.text : ""))
                    .join("\n") || "",
                )
              })
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

      const cache = yield* InstanceState.make<State>((ctx) => init(ctx))

      const get = Effect.fn("Command.get")(function* (name: string) {
        const state = yield* InstanceState.get(cache)
        return state.commands[name]
      })

      const list = Effect.fn("Command.list")(function* () {
        const state = yield* InstanceState.get(cache)
        return Object.values(state.commands)
      })

      return Service.of({ get, list })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(Skill.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get(name: string) {
    return runPromise((svc) => svc.get(name))
  }

  export async function list() {
    return runPromise((svc) => svc.list())
  }
}

