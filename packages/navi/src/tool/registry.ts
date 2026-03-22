import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { ParallelTool } from "./parallel"
import { BrowserTool } from "./browser"
import { CheckpointTool } from "./checkpoint"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvestigateTool } from "./investigate"
import { InvalidTool } from "./invalid"
import { ShadowWorkspaceTool } from "./shadow"
import { SkillTool } from "./skill"
import { BackgroundTaskTool, BackgroundOutputTool, BackgroundCancelTool } from "./background-task"
import { AstGrepTool } from "./ast-grep"
import { SwarmTool } from "./swarm"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolDefinition } from "@navi-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { GoogleSearchTool } from "./google-search"
import { CodeSearchTool } from "./codesearch"
import { WebCrawlTool } from "./webcrawl"
import { WebScrapeTool } from "./webscrape"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { LookAtTool } from "./look-at"
import { SessionListTool, SessionReadTool, SessionInfoTool } from "./session"
import { InteractiveBashTool } from "./interactive-bash"
import { CanvasTool } from "./canvas"
import { DocumentReaderTool } from "./document-reader"
import { DocumentWriterTool } from "./document-writer"
import { PermissionModeGetTool, PermissionModeSetTool, PermissionModeCycleTool } from "./permission-mode"
import { MapCodebaseTool, PlanPhaseTool, ExecutePhaseTool, StateTrackerTool, GsdTodoTool, QuickTaskTool } from "./gsd"
import { AutoDebugTool } from "./auto-debug"
import { PinTool } from "./pin"
import { MemoryTool } from "./memory"
import {
  AnalyzeTaskComplexityTool,
  GetAdaptiveThinkingTool,
  SuggestThinkingLevelTool,
  AutoAdjustThinkingTool,
  SuggestPermissionModeTool,
  SuggestPermissionRulesTool,
  SelectToolsForTaskTool,
  SuggestToolForTaskTool,
  SuggestSwarmTool,
  CreateSwarmPlanTool,
  GenerateLearningSummaryTool,
  LearnFromTaskTool,
  SuggestToolFromLearningTool,
  RunSwarmTool,
} from "./advanced-features"
import { DelegateToPeerTool, BroadcastToPeersTool, ListPeersTool } from "./delegate-peer"
import { CheckPeerStatusTool, PreFlightCheckTool } from "./check-peer"
import { SendMessageToPeerTool, AskPeerTool, AssignTaskToPeerTool, CoordinateWithPeersTool } from "./peer-messaging"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")

    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({
        cwd: dir,
        absolute: true,
        followSymlinks: true,
        dot: true,
      })) {
        const namespace = path.basename(match, path.extname(match))
        const mod = await import(match)
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
        }
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        execute: async (args, ctx) => {
          const result = await def.execute(args as any, ctx)
          const out = await Truncate.output(result, {}, initCtx?.agent, ctx.sessionID)
          return {
            title: "",
            output: out.truncated ? out.content : result,
            metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
          }
        },
      }),
    }
  }

  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then((x) => x.custom)
    const config = await Config.get()

    return [
      InvalidTool,
      ...(Flag.NAVI_CLIENT === "cli" ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      InvestigateTool,
      EditTool,
      WriteTool,
      TaskTool,
      ParallelTool,
      BrowserTool,
      SwarmTool,
      CheckpointTool,
      ShadowWorkspaceTool,
      WebFetchTool,
      TodoWriteTool,
      TodoReadTool,
      WebSearchTool,
      GoogleSearchTool,
      CodeSearchTool,
      WebCrawlTool,
      WebScrapeTool,
      SkillTool,
      BackgroundTaskTool,
      BackgroundOutputTool,
      BackgroundCancelTool,
      AstGrepTool,
      LookAtTool,
      SessionListTool,
      SessionReadTool,
      SessionInfoTool,
      InteractiveBashTool,
      CanvasTool,
      DocumentReaderTool,
      DocumentWriterTool,
      PermissionModeGetTool,
      PermissionModeSetTool,
      PermissionModeCycleTool,
      QuickTaskTool,
      GsdTodoTool,
      StateTrackerTool,
      ExecutePhaseTool,
      PlanPhaseTool,
      MapCodebaseTool,
      AutoDebugTool,
      PinTool,
      // Advanced Features
      AnalyzeTaskComplexityTool,
      GetAdaptiveThinkingTool,
      SuggestThinkingLevelTool,
      AutoAdjustThinkingTool,
      SuggestPermissionModeTool,
      SuggestPermissionRulesTool,
      SelectToolsForTaskTool,
      SuggestToolForTaskTool,
      SuggestSwarmTool,
      CreateSwarmPlanTool,
      GenerateLearningSummaryTool,
      LearnFromTaskTool,
      SuggestToolFromLearningTool,
      RunSwarmTool,
      // P2P Communication Tools
      DelegateToPeerTool,
      BroadcastToPeersTool,
      ListPeersTool,
      CheckPeerStatusTool,
      PreFlightCheckTool,
      SendMessageToPeerTool,
      AskPeerTool,
      AssignTaskToPeerTool,
      CoordinateWithPeersTool,
      ...(Flag.NAVI_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...custom,
      MemoryTool,
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.id))
  }

  export async function tools(providerID: string, agent?: Agent.Info) {
    const tools = await all()
    const result = await Promise.all(
      tools
        .filter((_t) => {
          // All tools are always available — web tools use the local browser engine (no API key needed)
          return true
        })
        .map(async (t) => {
          using _ = log.time(t.id)
          return {
            id: t.id,
            ...(await t.init({ agent })),
          }
        }),
    )
    return result
  }
}
