import { Config } from "@/config/config"
import z from "zod"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { generateObject, streamObject, type ModelMessage } from "ai"
import { Truncate } from "@/tool/truncate"
import { Auth } from "../auth"
import { ProviderTransform } from "@/provider/transform"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SCOUT from "./prompt/scout.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_ARCHITECT from "./prompt/architect.txt"
import PROMPT_TDD from "./prompt/tdd.txt"
import PROMPT_REVIEWER from "./prompt/reviewer.txt"
import PROMPT_RESEARCHER from "./prompt/researcher.txt"
import PROMPT_BRIDGE from "./prompt/bridge.txt"
import PROMPT_DEBUGGER from "./prompt/debugger.txt"
import PROMPT_SECURITY from "./prompt/security.txt"
import PROMPT_OPTIMIZER from "./prompt/optimizer.txt"
import { Permission } from "@/permission"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { Global } from "@navi-ai/core/global"
import { Flag } from "@navi-ai/core/flag/flag"
import path from "path"
import { Plugin } from "@/plugin"
import { Skill } from "../skill"
import { Effect, Context, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import * as Option from "effect/Option"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { zod } from "@navi-ai/core/effect-zod"
import { withStatics, type DeepMutable } from "@navi-ai/core/schema"
import { Reference } from "@/reference/reference"

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: Permission.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelID,
      providerID: ProviderID,
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
})
  .annotate({ identifier: "Agent" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>

export interface Interface {
  readonly get: (agent: string) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }) => Effect.Effect<{
    identifier: string
    whenToUse: string
    systemPrompt: string
  }>
}

type State = Omit<Interface, "generate">

export class Service extends Context.Service<Service, Interface>()("@navi/Agent") {}

import PROMPT_ACADEMIC_ANTHROPOLOGIST from "./prompts/academic-anthropologist.md"
import PROMPT_ACADEMIC_GEOGRAPHER from "./prompts/academic-geographer.md"
import PROMPT_ACADEMIC_HISTORIAN from "./prompts/academic-historian.md"
import PROMPT_ACADEMIC_NARRATOLOGIST from "./prompts/academic-narratologist.md"
import PROMPT_ACADEMIC_PSYCHOLOGIST from "./prompts/academic-psychologist.md"

const EXTRACTED_PROMPTS = {
  "academic-anthropologist": PROMPT_ACADEMIC_ANTHROPOLOGIST,
  "academic-geographer": PROMPT_ACADEMIC_GEOGRAPHER,
  "academic-historian": PROMPT_ACADEMIC_HISTORIAN,
  "academic-narratologist": PROMPT_ACADEMIC_NARRATOLOGIST,
  "academic-psychologist": PROMPT_ACADEMIC_PSYCHOLOGIST,
} as const

const EXTRACTED_AGENTS = [
  "academic-anthropologist",
  "academic-geographer",
  "academic-historian",
  "academic-narratologist",
  "academic-psychologist",
] as const

type ExtractedAgent = (typeof EXTRACTED_AGENTS)[number]

const EXTRACTED_AGENT_META: Record<
  ExtractedAgent,
  { name: string; description: string; mode: "subagent"; native: false; color: string }
> = {
  "academic-anthropologist": {
    name: "academic-anthropologist",
    description: "",
    mode: "subagent",
    native: false,
    color: "gray",
  },
  "academic-geographer": {
    name: "academic-geographer",
    description: "",
    mode: "subagent",
    native: false,
    color: "gray",
  },
  "academic-historian": {
    name: "academic-historian",
    description: "",
    mode: "subagent",
    native: false,
    color: "gray",
  },
  "academic-narratologist": {
    name: "academic-narratologist",
    description: "",
    mode: "subagent",
    native: false,
    color: "gray",
  },
  "academic-psychologist": {
    name: "academic-psychologist",
    description: "",
    mode: "subagent",
    native: false,
    color: "gray",
  },
}

const loadImportedAgents = Effect.fnUntraced(function* (
  defaults: Permission.Ruleset,
  user: Permission.Ruleset,
) {
  const { getImportedAgents } = yield* Effect.promise(() => import("./imported"))
  const imported = getImportedAgents(defaults, user)
  const permission = Permission.merge(defaults, user)
  const extracted = EXTRACTED_AGENTS.reduce<Record<string, Info>>((acc, key) => {
    acc[key] = {
      ...EXTRACTED_AGENT_META[key],
      options: {},
      prompt: EXTRACTED_PROMPTS[key],
      permission,
    }
    return acc
  }, {})
  return { ...imported, ...extracted }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const skill = yield* Skill.Service
    const provider = yield* Provider.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Agent.state")(function* (ctx) {
        const cfg = yield* config.get()
        const skillDirs = yield* skill.dirs()
        const whitelistedDirs = [
          Truncate.GLOB,
          path.join(Global.Path.tmp, "*"),
          ...skillDirs.map((dir) => path.join(dir, "*")),
        ]
        const readonlyExternalDirectory = {
          "*": "ask",
          ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
        } satisfies Record<string, "allow" | "ask" | "deny">

        const defaults = Permission.fromConfig({
          "*": "allow",
          doom_loop: "ask",
          external_directory: {
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
          question: "deny",
          plan_enter: "deny",
          plan_exit: "deny",
          repo_clone: "deny",
          repo_overview: "deny",
          browser: "ask",
          // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
          read: {
            "*": "allow",
            "*.env": "ask",
            "*.env.*": "ask",
            "*.env.example": "allow",
          },
        })

        const user = Permission.fromConfig(cfg.permission ?? {})

        const agents: Record<string, Info> = {
          build: {
            name: "build",
            description: "The default agent. Executes tools based on configured permissions.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          plan: {
            name: "plan",
            description: "Plan mode. Disallows all edit tools.",
            options: {},
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_exit: "allow",
                external_directory: {
                  [path.join(Global.Path.data, "plans", "*")]: "allow",
                },
                edit: {
                  "*": "deny",
                  [path.join(".navi", "plans", "*.md")]: "allow",
                  [path.relative(ctx.worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow",
                },
              }),
              user,
            ),
            mode: "primary",
            native: true,
          },
          general: {
            name: "general",
            description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                todowrite: "deny",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
          },
          explore: {
            name: "explore",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
                grep: "allow",
                glob: "allow",
                list: "allow",
                bash: "allow",
                webfetch: "allow",
                webscrape: "allow",
                webcrawl: "allow",
                websearch: "allow",
                grounding: "allow",
                tavily: "allow",
                firecrawl: "allow",
                exa_search: "allow",
                ddg_search: "allow",
                googlesearch: "allow",
                search: "allow",
                read: "allow",
                external_directory: readonlyExternalDirectory,
              }),
              user,
            ),
            description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
            prompt: PROMPT_EXPLORE,
            options: {},
            mode: "subagent",
            native: true,
          },
          ...(Flag.NAVI_EXPERIMENTAL_SCOUT
            ? {
                scout: {
                  name: "scout",
                  permission: Permission.merge(
                    defaults,
                    Permission.fromConfig({
                      "*": "deny",
                      grep: "allow",
                      glob: "allow",
                      webfetch: "allow",
                      webscrape: "allow",
                      webcrawl: "allow",
                      websearch: "allow",
                      grounding: "allow",
                      tavily: "allow",
                      firecrawl: "allow",
                      exa_search: "allow",
                      ddg_search: "allow",
                      googlesearch: "allow",
                      search: "allow",
                      codesearch: "allow",
                      read: "allow",
                      repo_clone: "allow",
                      repo_overview: "allow",
                      external_directory: {
                        ...readonlyExternalDirectory,
                        [path.join(Global.Path.repos, "*")]: "allow",
                      },
                    }),
                    user,
                  ),
                  description: `Docs and dependency-source specialist. Use this when you need to inspect external documentation, clone dependency repositories into the managed cache, and research library implementation details without modifying the user's workspace.`,
                  prompt: PROMPT_SCOUT,
                  options: {},
                  mode: "subagent" as const,
                  native: true,
                },
              }
            : {}),
          compaction: {
            name: "compaction",
            mode: "primary",
            native: true,
            hidden: true,
            prompt: PROMPT_COMPACTION,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            options: {},
          },
          title: {
            name: "title",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            temperature: 0.5,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_TITLE,
          },
          summary: {
            name: "summary",
            mode: "primary",
            options: {},
            native: true,
            hidden: true,
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                "*": "deny",
              }),
              user,
            ),
            prompt: PROMPT_SUMMARY,
          },
          architect: {
            name: "architect",
            description: "Specialized architect agent for system design, structural planning, and technical roadmap forge. Use this agent when you need high-level synthesis, complex architecture design, or decomposing major features.",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                plan_enter: "allow",
                plan_exit: "allow",
                arch_map: "allow",
              }),
              user,
            ),
            prompt: PROMPT_ARCHITECT,
            options: {},
            mode: "all",
            native: true,
            color: "orange",
          },
          tdd: {
            name: "tdd",
            description: "Test-Driven Development specialist agent. Implements robust, verified software through disciplined Red-Green-Refactor cycles using automated tests before finalizing edits.",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                test_runner: "allow",
              }),
              user,
            ),
            prompt: PROMPT_TDD,
            options: {},
            mode: "subagent",
            native: true,
            color: "blue",
          },
          reviewer: {
            name: "reviewer",
            description: "Elite code quality, security auditor, and architectural integrity specialist. Use this agent to audit git diffs, inspect security vulnerabilities, check edge cases, and verify project conventions before committing.",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                edit: "deny",
                write: "deny",
              }),
              user,
            ),
            prompt: PROMPT_REVIEWER,
            options: {},
            mode: "subagent",
            native: true,
            color: "green",
          },
          researcher: {
            name: "researcher",
            description: "Deep research orchestrator for evidence-backed investigations, external documentation analysis, and structured codebase lookup.",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                arch_map: "allow",
              }),
              user,
            ),
            prompt: PROMPT_RESEARCHER,
            options: {},
            mode: "subagent",
            native: true,
            color: "cyan",
          },
          bridge: {
            name: "bridge",
            description: "Frontier AI Web Consultant subagent. Uses automated browser interaction in an isolated sandbox to consult Frontier AI models (Kimi, DeepSeek-R1, Claude, ChatGPT) at zero token bill, returning only distilled code and findings.",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                browser: "allow",
              }),
              user,
            ),
            prompt: PROMPT_BRIDGE,
            options: {},
            mode: "subagent",
            native: true,
            color: "purple",
          },
          "github-reviewer": {
            name: "github-reviewer",
            description: "Specialized agent for GitHub Pull Request reviews",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            color: "green",
          },
          "github-triage": {
            name: "github-triage",
            description: "Specialized agent for triaging GitHub issues",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            color: "yellow",
          },
          "release-notes": {
            name: "release-notes",
            description: "Specialized agent for generating release notes",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
              }),
              user,
            ),
            options: {},
            mode: "subagent",
            native: true,
            color: "purple",
          },
          debugger: {
            name: "debugger",
            description: "Specialized root-cause analysis and bug diagnosis agent. Investigates error logs, isolates reproduction test cases, and traces execution paths before fixing.",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                test_runner: "allow",
              }),
              user,
            ),
            prompt: PROMPT_DEBUGGER,
            options: {},
            mode: "subagent",
            native: true,
            color: "magenta",
          },
          security: {
            name: "security",
            description: "Specialized application security and vulnerability auditor. Inspects code, dependencies, and APIs for OWASP Top 10 vulnerabilities, injection flaws, and secret leaks.",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                edit: "deny",
                write: "deny",
              }),
              user,
            ),
            prompt: PROMPT_SECURITY,
            options: {},
            mode: "subagent",
            native: true,
            color: "red",
          },
          optimizer: {
            name: "optimizer",
            description: "Performance profiling, runtime optimization, and code simplification agent. Optimizes time/memory complexity, removes dead code, and reduces complexity without breaking behavior.",
            permission: Permission.merge(
              defaults,
              Permission.fromConfig({
                question: "allow",
                test_runner: "allow",
              }),
              user,
            ),
            prompt: PROMPT_OPTIMIZER,
            options: {},
            mode: "subagent",
            native: true,
            color: "blue",
          },
        }

        Object.assign(agents, yield* loadImportedAgents(defaults, user))

        if (!Flag.NAVI_DISABLE_DEFAULT_PLUGINS) {
          const { getOfficialAgents } = yield* Effect.promise(() => import("@/plugin/official"))
          Object.assign(agents, getOfficialAgents(defaults, user))
        }

        for (const [key, value] of Object.entries(cfg.agent ?? {})) {
          if (value.disable) {
            delete agents[key]
            continue
          }
          let item = agents[key]
          if (!item)
            item = agents[key] = {
              name: key,
              mode: "all",
              permission: Permission.merge(defaults, user),
              options: {},
              native: false,
            }
          if (value.model) item.model = Provider.parseModel(value.model)
          item.variant = value.variant ?? item.variant
          item.prompt = value.prompt ?? item.prompt
          item.description = value.description ?? item.description
          item.temperature = value.temperature ?? item.temperature
          item.topP = value.top_p ?? item.topP
          item.mode = value.mode ?? item.mode
          item.color = value.color ?? item.color
          item.hidden = value.hidden ?? item.hidden
          item.name = value.name ?? item.name
          item.steps = value.steps ?? item.steps
          item.options = mergeDeep(item.options, value.options ?? {})
          item.permission = Permission.merge(item.permission, Permission.fromConfig(value.permission ?? {}))
        }

        function referencePrompt(reference: Reference.Resolved) {
          if (reference.kind === "local") {
            return [
              `You are configured reference @${reference.name}, a read-only research agent for external reference material.`,
              `Local directory: ${reference.path}`,
              `Inspect this directory as the primary reference source. Prefer repo_overview with path ${JSON.stringify(reference.path)} before broader searches. Do not edit files.`,
              `Return exact absolute file paths for findings whenever possible.`,
            ].join("\n\n")
          }

          if (reference.kind === "invalid") {
            return [
              `You are configured reference @${reference.name}, but this reference is not usable yet.`,
              `Configured repository: ${reference.repository}`,
              `Problem: ${reference.message}`,
              `Explain this configuration problem if invoked. Do not edit files or attempt fallback clones.`,
            ].join("\n\n")
          }

          return [
            `You are configured reference @${reference.name}, a read-only research agent for external reference material.`,
            `Repository: ${reference.repository}`,
            ...(reference.branch ? [`Branch/ref: ${reference.branch}`] : []),
            `Cached directory: ${reference.path}`,
            `Navi materializes this configured repository before use. Do not call repo_clone for this reference.`,
            `Inspect the cached directory as the primary reference source. Prefer repo_overview with path ${JSON.stringify(reference.path)} before broader searches, then use Glob, Grep, and Read inside that directory. Do not edit files.`,
            `Return exact absolute file paths for findings whenever possible.`,
          ].join("\n\n")
        }

        function referenceDescription(reference: Reference.Resolved) {
          if (reference.kind === "local") return `Scout reference for local directory ${reference.path}`
          if (reference.kind === "git") return `Scout reference for repository ${reference.repository}`
          return `Invalid Scout reference for repository ${reference.repository}`
        }

        if (Flag.NAVI_EXPERIMENTAL_SCOUT) {
          const resolvedReferences = Reference.resolveAll({
            references: cfg.reference ?? {},
            directory: ctx.directory,
            worktree: ctx.worktree,
          })
          for (const resolved of resolvedReferences) {
            if (agents[resolved.name]) continue
            const scout = agents["scout"]
            if (!scout) continue
            const localPath = resolved.kind === "invalid" ? undefined : resolved.path
            agents[resolved.name] = {
              name: resolved.name,
              description: referenceDescription(resolved),
              permission: Permission.merge(
                scout.permission,
                Permission.fromConfig({
                  repo_clone: "deny",
                  ...(localPath
                    ? {
                        external_directory: {
                          [localPath]: "allow",
                          [path.join(localPath, "*")]: "allow",
                        },
                      }
                    : {}),
                }),
              ),
              prompt: referencePrompt(resolved),
              options: { reference: cfg.reference?.[resolved.name], resolved },
              mode: "subagent",
              native: false,
            }
          }
        }

        // Ensure Truncate.GLOB is allowed unless explicitly configured
        for (const name in agents) {
          const agent = agents[name]
          if (!agent) continue
          const explicit = agent.permission.some((r) => {
            if (r.permission !== "external_directory") return false
            if (r.action !== "deny") return false
            return r.pattern === Truncate.GLOB
          })
          if (explicit) continue

          agent.permission = Permission.merge(
            agent.permission,
            Permission.fromConfig({ external_directory: { [Truncate.GLOB]: "allow" } }),
          )
        }

        const get = Effect.fnUntraced(function* (agent: string) {
          const direct = agents[agent]
          if (direct) return direct
          const lowerAgent = agent.toLowerCase()
          const matchedByKey = Object.keys(agents).find((key) => key.toLowerCase() === lowerAgent)
          if (matchedByKey) {
            const found = agents[matchedByKey]
            if (found) return found
          }
          const matchedByName = Object.values(agents).find((a) => a.name.toLowerCase() === lowerAgent)
          if (matchedByName) return matchedByName
          const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, "")
          const normalizedAgent = normalize(agent)
          const matchedByNormalizedKey = Object.keys(agents).find((key) => normalize(key) === normalizedAgent)
          if (matchedByNormalizedKey) {
            const found = agents[matchedByNormalizedKey]
            if (found) return found
          }
          const matchedByNormalizedName = Object.values(agents).find((a) => normalize(a.name) === normalizedAgent)
          if (matchedByNormalizedName) return matchedByNormalizedName
          return undefined as unknown as Info
        })

        const list = Effect.fnUntraced(function* () {
          const cfg = yield* config.get()
          return pipe(
            agents,
            values(),
            sortBy(
              [(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"],
              [(x) => x.name.toLowerCase(), "asc"],
            ),
          )
        })

        const defaultAgent = Effect.fnUntraced(function* () {
          const c = yield* config.get()
          if (c.default_agent) {
            const agent = agents[c.default_agent]
            if (!agent) throw new Error(`default agent "${c.default_agent}" not found`)
            if (agent.mode === "subagent") throw new Error(`default agent "${c.default_agent}" is a subagent`)
            if (agent.hidden === true) throw new Error(`default agent "${c.default_agent}" is hidden`)
            return agent.name
          }
          const visible = Object.values(agents).find((a) => a.mode !== "subagent" && a.hidden !== true)
          if (!visible) throw new Error("no primary visible agent found")
          return visible.name
        })

        return {
          get,
          list,
          defaultAgent,
        } satisfies State
      }),
    )

    return Service.of({
      get: Effect.fn("Agent.get")(function* (agent: string) {
        return yield* InstanceState.useEffect(state, (s) => s.get(agent))
      }),
      list: Effect.fn("Agent.list")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.list())
      }),
      defaultAgent: Effect.fn("Agent.defaultAgent")(function* () {
        return yield* InstanceState.useEffect(state, (s) => s.defaultAgent())
      }),
      generate: Effect.fn("Agent.generate")(function* (input: {
        description: string
        model?: { providerID: ProviderID; modelID: ModelID }
      }) {
        const cfg = yield* config.get()
        const model = input.model ?? (yield* provider.defaultModel())
        const resolved = yield* provider.getModel(model.providerID, model.modelID)
        const language = yield* provider.getLanguage(resolved)
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        yield* plugin.trigger("experimental.chat.system.transform", { model: resolved }, { system })
        const existing = yield* InstanceState.useEffect(state, (s) => s.list())

        // TODO: clean this up so provider specific logic doesnt bleed over
        const authInfo = yield* auth.get(model.providerID).pipe(Effect.orDie)
        const isOpenaiOauth = model.providerID === "openai" && authInfo?.type === "oauth"

        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: z.object({
            identifier: z.string(),
            whenToUse: z.string(),
            systemPrompt: z.string(),
          }),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(resolved, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((r) => r.object))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Plugin.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Skill.defaultLayer),
)

export async function get(agent: string) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Service.use((svc) => svc.get(agent)))
}

export async function list() {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Service.use((svc) => svc.list()))
}

export async function defaultAgent() {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Service.use((svc) => svc.defaultAgent()))
}

export * as Agent from "./agent"
