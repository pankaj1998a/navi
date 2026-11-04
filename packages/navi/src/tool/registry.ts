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
import { TestRunnerTool } from "./test-runner"
import { BrowserTool } from "./browser"
import { ArchMapTool } from "./arch-map"
import { CheckpointTool } from "./checkpoint"
import { TrashTool } from "./trash"
import { GithubUploadTool } from "./github-upload"
import { AgentationTool } from "./agentation"
import { BridgeTool } from "./bridge"
import { ReverseAnalyzeJavascriptTool } from "./reverse-analyze-javascript"
import { ReverseAnalyzeManagedTool } from "./reverse-analyze-managed"
import { ReverseAnalyzeApkTool } from "./reverse-analyze-apk"
import { ReverseAnalyzeEvmTool } from "./reverse-analyze-evm"
import { ReverseAnalyzeFirmwareTool } from "./reverse-analyze-firmware"
import { ReverseAnalyzeNativeTool } from "./reverse-analyze-native"
import { ReverseAnalyzeAppleTool } from "./reverse-analyze-apple"
import { ReverseAnalyzeWebTool } from "./reverse-analyze-web"
import { ReverseDoctorTool } from "./reverse-doctor"
import { GitWorktreeTool } from "./git-worktree"
import { PtcEvalTool } from "./ptc-eval"
import { DeliverableTool } from "./deliverable"
import { SpillReadTool } from "./spill"
import { GoalTool } from "./goal"
import { SwarmTool } from "./swarm"
import { MagicDocsTool } from "./magic-docs"
import { AcpDelegateTool } from "./acp-delegate"
import { DiagramDesignTool } from "./diagram"
import { ContextModeTool } from "./context-mode"
import { PptMasterTool } from "./ppt-master"
import { SecurityScanTool } from "./security-scan"
import { SecurityChecksecTool } from "./security-checksec"
import { SecurityAuditWebTool } from "./security-audit-web"
import { HashlineEditTool } from "./hashline-edit"
import { ImageGenerateTool } from "./image-generate"
import { VcrTool } from "./vcr"
import { SecurityThreatModelTool } from "./security-threat-model"
import { SecurityCoverageTool } from "./security-coverage"
import { SecurityReportTool } from "./security-report"
import { SecurityProxyTool } from "./security-proxy"
import { SecurityNotesTool } from "./security-notes"
import { SecuritySkillTool } from "./security-skill"
import { KnowledgeTool } from "./knowledge"
import { HeadroomRetrieveTool } from "./headroom-retrieve"
import { CostTrackerTool } from "./cost-tracker"
import { ScheduleTool } from "./schedule"
import { TeleportTool } from "./teleport"
import { VimTool } from "./vim"
import { VoiceTool } from "./voice"
import { PackageVersionsTool } from "./package-versions"
import { Glob } from "@navi-ai/core/util/glob"
import path from "path"
import { stat } from "fs/promises"
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

async function fsStat(target: string) {
  try {
    return await stat(target)
  } catch {
    return undefined
  }
}

export function webSearchEnabled(
  providerID: ProviderID,
  flags = { exa: Flag.NAVI_ENABLE_EXA, parallel: Flag.NAVI_ENABLE_PARALLEL },
) {
  return flags.exa || flags.parallel
}

// Removed local Interface and Service definitions to break circular dependencies.
// They are now imported from ./registry-service.ts

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
  /**
   * Per-(provider, model, agent) cache of the resolved tool descriptor list.
   * Building it re-runs plugin `tool.definition` hooks, permission filtering and
   * `describeSkill` / `describeTask`, which is pure work per step: the tool set
   * and skill/agent state are fixed for the lifetime of an instance, so the
   * result only has to change when the instance (and therefore this state) is
   * rebuilt.
   */
  cache: Map<string, { generation: number; tools: Tool.Def<any, any>[] }>
}

/**
 * Bumped by {@link invalidateToolCaches}. Every cached entry remembers the
 * generation it was built under, so callers (config reload, tests) can drop
 * every derived value without walking each instance.
 */
let cacheGeneration = 0

/** Test/hot-reload hook: drop all module-level tool caches. */
export function invalidateToolCaches() {
  cacheGeneration++
  customToolScanCache.clear()
}

const CUSTOM_TOOL_SCAN_TTL_MS = 30_000
/** Distinct config-dir sets kept at once; each entry is a handful of paths. */
const MAX_CUSTOM_TOOL_SCAN_ENTRIES = 32

/**
 * Custom tool file discovery (`{tool,tools}/*.{js,ts}`) is a directory walk per
 * config dir. It used to run synchronously on every instance bootstrap; keep the
 * result cached per directory list and revalidate cheaply by the mtimes of the
 * `tool`/`tools` folders instead of re-globbing every time.
 */
const customToolScanCache = new Map<string, { at: number; mtimes: string; matches: string[] }>()

async function scanCustomToolFiles(dirs: string[]): Promise<string[]> {
  const key = dirs.join("\u0000")
  const mtimes: string[] = []
  for (const dir of dirs) {
    for (const name of ["tool", "tools"]) {
      const stat = await fsStat(path.join(dir, name))
      mtimes.push(stat ? `${stat.mtimeMs}:${stat.size}` : "-")
    }
  }
  const stamp = mtimes.join("|")
  const cached = customToolScanCache.get(key)
  if (cached && cached.mtimes === stamp && Date.now() - cached.at < CUSTOM_TOOL_SCAN_TTL_MS) return cached.matches

  const matches = (
    await Promise.all(
      dirs.map((dir) =>
        Glob.scan("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }).catch(
          () => [] as string[],
        ),
      ),
    )
  ).flat()
  if (customToolScanCache.size >= MAX_CUSTOM_TOOL_SCAN_ENTRIES) customToolScanCache.clear()
  customToolScanCache.set(key, { at: Date.now(), mtimes: stamp, matches })
  return matches
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
    const testrunner = yield* TestRunnerTool
    const browsertool = yield* BrowserTool
    const archmap = yield* ArchMapTool
    const checkpointtool = yield* CheckpointTool
    const trashtool = yield* TrashTool
    const githubupload = yield* GithubUploadTool
    const agentationtool = yield* AgentationTool
    const bridgetool = yield* BridgeTool
    const reversejs = yield* ReverseAnalyzeJavascriptTool
    const reversemanaged = yield* ReverseAnalyzeManagedTool
    const reverseapk = yield* ReverseAnalyzeApkTool
    const reverseevm = yield* ReverseAnalyzeEvmTool
    const reversefirmware = yield* ReverseAnalyzeFirmwareTool
    const reversenative = yield* ReverseAnalyzeNativeTool
    const reverseapple = yield* ReverseAnalyzeAppleTool
    const reverseweb = yield* ReverseAnalyzeWebTool
    const reversedoctor = yield* ReverseDoctorTool
    const gitworktree = yield* GitWorktreeTool
    const ptceval = yield* PtcEvalTool
    const deliverable = yield* DeliverableTool
    const spillread = yield* SpillReadTool
    const goaltool = yield* GoalTool
    const swarmtool = yield* SwarmTool
    const magicdocstool = yield* MagicDocsTool
    const acpdelegatetool = yield* AcpDelegateTool
    const diagramtool = yield* DiagramDesignTool
    const contextmodetool = yield* ContextModeTool
    const pptmastertool = yield* PptMasterTool
    const securityscan = yield* SecurityScanTool
    const securitychecksec = yield* SecurityChecksecTool
    const securityauditweb = yield* SecurityAuditWebTool
    const hashlineedit = yield* HashlineEditTool
    const imagegenerate = yield* ImageGenerateTool
    const vcrtool = yield* VcrTool
    const securitythreatmodel = yield* SecurityThreatModelTool
    const securitycoverage = yield* SecurityCoverageTool
    const securityreport = yield* SecurityReportTool
    const securityproxy = yield* SecurityProxyTool
    const securitynotes = yield* SecurityNotesTool
    const securityskill = yield* SecuritySkillTool
    const knowledgetool = yield* KnowledgeTool
    const headroomretrievetool = yield* HeadroomRetrieveTool
    const costtrackertool = yield* CostTrackerTool
    const scheduletool = yield* ScheduleTool
    const teleporttool = yield* TeleportTool
    const vimtool = yield* VimTool
    const voicetool = yield* VoiceTool
    const packageversionstool = yield* PackageVersionsTool

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
                const result = yield* Effect.promise(() => def.execute(args as z.infer<typeof zodParams>, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const { wrapUntrustedContent, sanitizeUntrustedText } = yield* Effect.promise(() =>
                  import("@/util/untrusted-content"),
                )
                const cleanOutput =
                  id.includes(":") || id.startsWith("mcp_") || id.startsWith("web")
                    ? wrapUntrustedContent(output, id)
                    : sanitizeUntrustedText(output)
                const info = yield* agents.get(toolCtx.agent)
                const out = yield* truncate.output(cleanOutput, {}, info)
                return {
                  title: "",
                  output: out.truncated ? out.content : cleanOutput,
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
        const matches = yield* Effect.promise(() => scanCustomToolFiles(dirs))
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
          test_runner: Tool.init(testrunner),
          browser: Tool.init(browsertool),
          arch_map: Tool.init(archmap),
          checkpoint: Tool.init(checkpointtool),
          trash: Tool.init(trashtool),
          github_upload: Tool.init(githubupload),
          agentation: Tool.init(agentationtool),
          bridge: Tool.init(bridgetool),
          reverse_js: Tool.init(reversejs),
          reverse_managed: Tool.init(reversemanaged),
          reverse_apk: Tool.init(reverseapk),
          reverse_evm: Tool.init(reverseevm),
          reverse_firmware: Tool.init(reversefirmware),
          reverse_native: Tool.init(reversenative),
          reverse_apple: Tool.init(reverseapple),
          reverse_web: Tool.init(reverseweb),
          reverse_doctor: Tool.init(reversedoctor),
          git_worktree: Tool.init(gitworktree),
          ptc_eval: Tool.init(ptceval),
          deliverable: Tool.init(deliverable),
          spill_read: Tool.init(spillread),
          goal_manage: Tool.init(goaltool),
          teammate_swarm: Tool.init(swarmtool),
          magic_docs: Tool.init(magicdocstool),
          acp_delegate: Tool.init(acpdelegatetool),
          diagram_design: Tool.init(diagramtool),
          context_mode: Tool.init(contextmodetool),
          ppt_master: Tool.init(pptmastertool),
          security_scan: Tool.init(securityscan),
          security_checksec: Tool.init(securitychecksec),
          security_audit_web: Tool.init(securityauditweb),
          hashline_edit: Tool.init(hashlineedit),
          image_generate: Tool.init(imagegenerate),
          vcr: Tool.init(vcrtool),
          security_threat_model: Tool.init(securitythreatmodel),
          security_coverage: Tool.init(securitycoverage),
          security_report: Tool.init(securityreport),
          security_proxy: Tool.init(securityproxy),
          security_notes: Tool.init(securitynotes),
          security_skill: Tool.init(securityskill),
          knowledge: Tool.init(knowledgetool),
          headroom_retrieve: Tool.init(headroomretrievetool),
          cost_tracker: Tool.init(costtrackertool),
          schedule: Tool.init(scheduletool),
          teleport: Tool.init(teleporttool),
          vim: Tool.init(vimtool),
          voice: Tool.init(voicetool),
          package_versions: Tool.init(packageversionstool),
        })

        return {
          custom,
          cache: new Map(),
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
            tool.test_runner,
            tool.browser,
            tool.arch_map,
            tool.checkpoint,
            tool.trash,
            tool.github_upload,
            tool.agentation,
            tool.reverse_js,
            tool.reverse_managed,
            tool.reverse_apk,
            tool.reverse_evm,
            tool.reverse_firmware,
            tool.reverse_native,
            tool.reverse_apple,
            tool.reverse_web,
            tool.reverse_doctor,
            tool.git_worktree,
            tool.ptc_eval,
            tool.deliverable,
            tool.spill_read,
            tool.goal_manage,
            tool.teammate_swarm,
            tool.magic_docs,
            tool.acp_delegate,
            tool.diagram_design,
            tool.context_mode,
            tool.ppt_master,
            tool.security_scan,
            tool.security_checksec,
            tool.security_audit_web,
            tool.bridge,
            tool.hashline_edit,
            tool.image_generate,
            tool.vcr,
            tool.security_threat_model,
            tool.security_coverage,
            tool.security_report,
            tool.security_proxy,
            tool.security_notes,
            tool.security_skill,
            tool.knowledge,
            tool.headroom_retrieve,
            tool.cost_tracker,
            tool.schedule,
            tool.teleport,
            tool.vim,
            tool.voice,
            tool.package_versions,
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

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info, items: Agent.Info[]) {
      const filtered = items
        .filter((item) => item.mode !== "primary")
        .filter((item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny")
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    /**
     * Stable description of the caller's permission surface. Two `Agent.Info`
     * objects with the same ruleset produce the same tool descriptions, so this
     * is all the cache key needs (agent names alone would let a config reload
     * that loosens/tightens `task`/`skill` permissions reuse a stale list).
     */
    const agentKey = (agent: Agent.Info) =>
      `${agent.name}\u0001${agent.mode}\u0001${(agent.permission ?? [])
        .map((rule) => `${rule.permission}:${rule.pattern}:${rule.action}`)
        .join(";")}`

    // `Agent.Info` is rebuilt only when the instance's Agent state is rebuilt,
    // which is the same lifetime as this registry's state — so agent identity in
    // the key is enough and `agents.list()` (a sort over every configured agent)
    // only runs on a cache miss.
    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const s = yield* InstanceState.get(state)
      const key = [
        input.providerID,
        input.modelID,
        agentKey(input.agent),
        // `webSearchEnabled` reads process flags at call time; keep them in the
        // key so flipping a flag invalidates instead of serving a stale list.
        Flag.NAVI_ENABLE_EXA ? "exa" : "",
        Flag.NAVI_ENABLE_PARALLEL ? "parallel" : "",
      ].join("\u0000")

      const cached = s.cache.get(key)
      if (cached && cached.generation === cacheGeneration) return cached.tools

      const agentItems = yield* agents.list()
      const filtered = [...s.builtin, ...s.custom].filter((tool) => {
        if (tool.id === WebSearchTool.id) {
          return webSearchEnabled(input.providerID)
        }

        const usePatch =
          input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        return true
      })

      const resolved = yield* Effect.forEach(
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
              tool.id === TaskTool.id ? yield* describeTask(input.agent, agentItems) : undefined,
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

      // Bounded: a session may mix many models/agents, but the descriptors are
      // large; keep the working set small and let misses recompute.
      if (s.cache.size > 64) s.cache.clear()
      s.cache.set(key, { generation: cacheGeneration, tools: resolved })
      return resolved
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
