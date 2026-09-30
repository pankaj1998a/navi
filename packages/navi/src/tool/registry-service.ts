import { Context, Effect } from "effect"
import type * as Tool from "./tool"
import type { ProviderID, ModelID } from "../provider/schema"
import type { Agent } from "../agent/agent"
import type { TaskTool } from "./task"
import type { ReadTool } from "./read"

export type TaskDef = Tool.InferDef<typeof TaskTool>
export type ReadDef = Tool.InferDef<typeof ReadTool>

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: { providerID: ProviderID; modelID: ModelID; agent: Agent.Info }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@navi/ToolRegistry") {}
