import { Registry, type AgentDefinition } from "./registry"
import { initializeSystemAgents } from "./registry/initialize"
import { AgentInfo } from "./info"
import { Effect, Layer, ServiceMap } from "effect"
import { loadPreferences } from "@/config/preferences"
import { makeRuntime } from "@/effect/run-service"

export namespace Agent {
  export const Info = AgentInfo
  export type Info = AgentInfo

  export interface Interface {
    readonly list: () => Effect.Effect<Info[]>
    readonly get: (id: string) => Effect.Effect<Info | null>
    readonly defaultAgent: () => Effect.Effect<string>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@navi/Agent") {}

  /**
   * Standard built-in agents that are always required for stability
   */
  const defaults: Info[] = [
    {
      name: "general",
      displayName: "General",
      description: "General purpose research and discussion assistant",
      mode: "primary",
      model: { providerID: "Navi", modelID: "big-pickle" },
      toolNames: ["read", "webfetch", "mcp", "skill"],
      color: "gray",
      options: {},
      permission: [],
    },
    {
      name: "build",
      displayName: "Build",
      description: "Primary agent for building and editing code",
      mode: "primary",
      model: { providerID: "Navi", modelID: "big-pickle" },
      toolNames: ["read", "write", "edit", "grep", "ls", "terminal", "mcp", "skill"],
      color: "blue",
      options: {},
      permission: [],
    },
    {
      name: "vibe",
      displayName: "Vibe",
      description: "Creative and aesthetic project orchestrator",
      mode: "primary",
      model: { providerID: "Navi", modelID: "big-pickle" },
      toolNames: ["read", "write", "edit", "grep", "ls", "terminal", "mcp", "swarm", "skill"],
      color: "purple",
      options: {},
      permission: [],
    },
  ]

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      initializeSystemAgents()
      const list = Effect.fn("Agent.list")(function* () {
        return yield* Effect.promise(async () => {
          let registryAgents: AgentDefinition[] = []
          try {
            registryAgents = await Registry.list()
          } catch (e) {
            // Registry might not be initialized yet
          }

          const mappedRegistry = registryAgents.map((a) => {
            let model: any = a.model
            if (typeof model === "string") {
              const parts = model.split("/")
              model = {
                providerID: parts[0] || "Navi",
                modelID: parts.slice(1).join("/") || parts[0],
              }
            }

            return {
              ...a,
              name: a.id,
              displayName: a.displayName,
              description: a.description || "",
              model,
              toolNames: a.toolNames || [],
              mode: "subagent" as any,
              hidden: !!a.hidden,
              options: (a as any).options || {},
              permission: (a as any).permission || [],
            }
          })

          const finalMap = new Map<string, Info>()
          for (const def of defaults) {
            finalMap.set(def.name, def)
          }
          for (const reg of mappedRegistry) {
            finalMap.set(reg.name, reg)
          }
          return Array.from(finalMap.values())
        })
      })

      const get = Effect.fn("Agent.get")(function* (id: string) {
        const all = yield* list()
        const agent = all.find((a) => a.name === id) ?? null
        if (!agent) return null
        
        // Merge user preferences for this specific agent
        const prefs = loadPreferences()
        const customModel = prefs.agentModels?.[id]
        if (customModel) {
            const { Provider } = yield* Effect.promise(() => import("../provider/provider"))
            return {
                ...agent,
                model: Provider.parseModel(customModel)
            }
        }
        
        return agent
      })

      const defaultAgent = Effect.fn("Agent.defaultAgent")(function* () {
        return "build"
      })

      return Service.of({
        list,
        get,
        defaultAgent,
      })
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, layer)

  export async function list() {
    return runPromise((svc) => svc.list())
  }

  export async function get(id: string) {
    return runPromise((svc) => svc.get(id))
  }

  export async function defaultAgent() {
    return runPromise((svc) => svc.defaultAgent())
  }

  /**
   * Generates a new agent configuration from a description.
   */
  export async function generate(options: { description: string; model?: { providerID: string; modelID: string } }): Promise<{
    identifier: string
    whenToUse: string
    systemPrompt: string
  }> {
    const { LLM } = await import("../session/llm")
    const { SessionID, MessageID } = await import("../session/schema")
    const { Provider } = await import("../provider/provider")
    const { ProviderID, ModelID } = await import("../provider/schema")

    const modelId = options.model || { providerID: "anthropic", modelID: "claude-3-5-sonnet-latest" }
    const model = await Provider.getModel(
        ProviderID.make(modelId.providerID), 
        ModelID.make(modelId.modelID)
    )

    const prompt = `
Generate a specialized developer agent based on this description: "${options.description}".
The agent should be task-focused and have a clear identity.

Return a JSON object with:
- identifier: a-kebab-case-name
- whenToUse: a short one-sentence description of when this agent is appropriate
- systemPrompt: a comprehensive, professional system prompt for the agent.

Example:
{
  "identifier": "rust-expert",
  "whenToUse": "Use this agent when writing or refactoring low-level Rust code or managing memory safety.",
  "systemPrompt": "You are a senior Rust systems engineer..."
}
    `.trim()

    const stream = await LLM.stream({
      sessionID: SessionID.descending(),
      model,
      agent: { name: "agent-gen", mode: "primary", permission: [], options: {} },
      user: { 
          id: MessageID.ascending(),
          sessionID: SessionID.descending(),
          role: "user", 
          time: { created: Date.now() },
          agent: "agent-gen",
          model: {
              providerID: model.providerID,
              modelID: model.id
          }
      },
      system: [],
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: {},
      abort: new AbortController().signal
    })

    let content = ""
    for await (const part of stream.fullStream) {
      if (part.type === "text-delta") content += part.textDelta
    }

    // Attempt to extract JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("LLM failed to return valid JSON agent configuration")
    
    return JSON.parse(jsonMatch[0])
  }
}
