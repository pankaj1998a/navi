import { PlanExitTool } from "./plan"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { ShellTool } from "./shell"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import * as Tool from "./tool"
import { SessionStatus } from "@/session/status"
import { Config } from "@/config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@navi-ai/plugin"
import { Schema } from "effect"
import z from "zod"
import { ZodOverride } from "@navi-ai/core/effect-zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { GoogleSearchTool } from "./google-search"
import { WebScrapeTool } from "./webscrape"
import { WebCrawlTool } from "./webcrawl"
import { GroundingTool } from "./grounding"
import { TavilySearchTool } from "./tavily-search"
import { FirecrawlTool } from "./firecrawl-tool"
import { ExaSearchTool } from "./exa-search"
import { DuckDuckGoSearchTool } from "./duckduckgo-search"
import { CodeSearchTool } from "./codesearch"
import { RepoCloneTool } from "./repo_clone"
import { RepoOverviewTool } from "./repo_overview"
import { Flag } from "@navi-ai/core/flag/flag"
import * as Log from "@navi-ai/core/util/log"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { ToolSearchTool } from "./tool-search"
import { Memory } from "@/memory"
import { History } from "@/history"
import { MemoryTool } from "./memory"
import { HistoryTool } from "./history"
import { Glob } from "@navi-ai/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Service, type Interface, type TaskDef, type ReadDef } from "./registry-service"
export { Service, type Interface, type TaskDef, type ReadDef } from "./registry-service"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@navi-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../file/ripgrep"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "@navi-ai/core/filesystem"
import { Bus } from "../bus"
import { Agent } from "../agent/agent"
import { Git } from "@/git"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { Reference } from "@/reference/reference"

const log = Log.create({ service: "tool.registry" })

export function webSearchEnabled(
  providerID: ProviderID,
  flags = { exa: Flag.NAVI_ENABLE_EXA, parallel: Flag.NAVI_ENABLE_PARALLEL },
) {
  return providerID === ProviderID.navi || flags.exa || flags.parallel
}

// Removed local Interface and Service definitions to break circular dependencies.
// They are now imported from ./registry-service.ts

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}


export const layer: Layer.Layer<
  Service,
  never,
  | Config.Service
  | Plugin.Service
  | Question.Service
  | Todo.Service
  | Agent.Service
  | Skill.Service
  | Session.Service
  | Provider.Service
  | Git.Service
  | Reference.Service
  | LSP.Service
  | Instruction.Service
  | AppFileSystem.Service
  | Bus.Service
  | HttpClient.HttpClient
  | ChildProcessSpawner
  | Ripgrep.Service
  | Format.Service
  | Truncate.Service
  | Memory.Service
  | History.Service
  | SessionStatus.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const skill = yield* Skill.Service
    const truncate = yield* Truncate.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const webscrape = yield* WebScrapeTool
    const webcrawl = yield* WebCrawlTool
    const grounding = yield* GroundingTool
    const tavily = yield* TavilySearchTool
    const firecrawl = yield* FirecrawlTool
    const exa = yield* ExaSearchTool
    const ddg = yield* DuckDuckGoSearchTool
    const googlesearch = yield* GoogleSearchTool
    const websearch = yield* WebSearchTool
    const codesearch = yield* CodeSearchTool
    const repoClone = yield* RepoCloneTool
    const repoOverview = yield* RepoOverviewTool
    const shell = yield* ShellTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const toolsearch = yield* ToolSearchTool
    const memorytool = yield* MemoryTool
    const historytool = yield* HistoryTool

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools define their args as a raw Zod shape. Wrap the
          // derived Zod object in a `Schema.declare` so it slots into the
          // Schema-typed framework, and annotate with `ZodOverride` so the
          // walker emits the original Zod object for LLM JSON Schema.
          const zodParams = z.object(def.args)
          const parameters = Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success).annotate({
            [ZodOverride]: zodParams,
          })
          return {
            id,
            parameters,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => toolCtx.ask(req),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const info = yield* agents.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: "",
                  output: out.truncated ? out.content : output,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }).pipe(
                Effect.withSpan("Tool.execute", {
                  attributes: {
                    "tool.name": id,
                    "session.id": toolCtx.sessionID,
                    "message.id": toolCtx.messageID,
                    ...(toolCtx.callID ? { "tool.call_id": toolCtx.callID } : {}),
                  },
                }),
              ),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        yield* config.get()
        const questionEnabled =
          ["app", "cli", "desktop"].includes(Flag.NAVI_CLIENT) || Flag.NAVI_ENABLE_QUESTION_TOOL

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          shell: Tool.init(shell),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          webscrape: Tool.init(webscrape),
          webcrawl: Tool.init(webcrawl),
          grounding: Tool.init(grounding),
          tavily: Tool.init(tavily),
          firecrawl: Tool.init(firecrawl),
          exa_search: Tool.init(exa),
          ddg_search: Tool.init(ddg),
          googlesearch: Tool.init(googlesearch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          code: Tool.init(codesearch),
          repo_clone: Tool.init(repoClone),
          repo_overview: Tool.init(repoOverview),
          skill: Tool.init(skilltool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
          tool_search: Tool.init(toolsearch),
          memory: Tool.init(memorytool),
          history: Tool.init(historytool),
        })

        return {
          custom,
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.shell,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.webscrape,
            tool.webcrawl,
            tool.grounding,
            tool.tavily,
            tool.firecrawl,
            tool.exa_search,
            tool.ddg_search,
            tool.googlesearch,
            tool.todo,
            tool.search,
            ...(Flag.NAVI_EXPERIMENTAL_SCOUT ? [tool.code, tool.repo_clone, tool.repo_overview] : []),
            tool.skill,
            tool.patch,
            tool.tool_search,
            tool.memory,
            tool.history,
            ...(Flag.NAVI_EXPERIMENTAL_LSP_TOOL ? [tool.lsp] : []),
            ...(Flag.NAVI_EXPERIMENTAL_PLAN_MODE && Flag.NAVI_CLIENT === "cli" ? [tool.plan] : []),
          ],
          task: tool.task,
          read: tool.read,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeSkill = Effect.fn("ToolRegistry.describeSkill")(function* (agent: Agent.Info) {
      const list = yield* skill.available(agent)
      if (list.length === 0) return "No skills are currently available."
      return [
        "Load a specialized skill that provides domain-specific instructions and workflows.",
        "",
        "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
        "",
        "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
        "",
        'Tool output includes a `<skill_content name="...">` block with the loaded content.',
        "",
        "The following skills provide specialized sets of instructions for particular tasks",
        "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
        "",
        Skill.fmt(list, { verbose: false }),
      ].join("\n")
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const filtered = (yield* all()).filter((tool) => {
        if (tool.id === WebSearchTool.id) {
          return webSearchEnabled(input.providerID)
        }

        const usePatch =
          input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        return true
      })

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def<any, any>) {
          using _ = log.time(tool.id)
          const output = {
            description: tool.description,
            parameters: tool.parameters,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          return {
            id: tool.id,
            description: [
              output.description,
              tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined,
              tool.id === SkillTool.id ? yield* describeSkill(input.agent) : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, tools })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Config.defaultLayer,
        Plugin.defaultLayer,
        Question.defaultLayer,
        Todo.defaultLayer,
        Skill.defaultLayer,
        Agent.defaultLayer,
        Session.defaultLayer,
        Provider.defaultLayer,
        Git.defaultLayer,
        Reference.defaultLayer,
        LSP.defaultLayer,
        Instruction.defaultLayer,
        SessionStatus.defaultLayer,
      ),
    ),
    Layer.provide(
      Layer.mergeAll(
        AppFileSystem.defaultLayer,
        Bus.layer,
        FetchHttpClient.layer,
        Format.defaultLayer,
        CrossSpawnSpawner.defaultLayer,
        Ripgrep.defaultLayer,
        Truncate.defaultLayer,
        Memory.defaultLayer,
        History.defaultLayer,
      ),
    ),
  ),
)

export const ToolRegistry = {
  Service,
  layer,
  defaultLayer,
}
