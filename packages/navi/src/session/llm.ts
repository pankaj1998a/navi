import os from "os"
import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  type CoreMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
} from "ai"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"
import { RESPONSE_FORMAT_PROMPT } from "./response"


export namespace LLM {
  const log = Log.create({ service: "llm" })

  export const OUTPUT_TOKEN_MAX = Flag.NAVI_EXPERIMENTAL_OUTPUT_TOKEN_MAX || 32_000

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: CoreMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    routingReasons?: string[]
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg] = await Promise.all([Provider.getLanguage(input.model), Config.get()])

    const system = SystemPrompt.header(input.model.providerID)
    system.push(
      [
        // use agent prompt otherwise provider prompt
        ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
        // Unified response format — injected for all user-facing (non-hidden) agents
        // Hidden agents (title, summary, compaction) produce structured output via other means.
        ...(!input.agent.hidden ? [RESPONSE_FORMAT_PROMPT] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )


    const header = system[0]
    const original = clone(system)
    await Plugin.trigger("experimental.chat.system.transform", { sessionID: input.sessionID }, { system })
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const provider = await Provider.getProvider(input.model.providerID)
    const auth = await Auth.get(input.model.providerID)
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options(input.model, input.sessionID, provider.options)
    const options: Record<string, any> = pipe(
      base as any,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
      options.store = false
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider: Provider.getProvider(input.model.providerID),
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const maxOutputTokens = isCodex
      ? undefined
      : ProviderTransform.maxOutputTokens(
        input.model.api.npm,
        params.options,
        input.model.limit.output,
        OUTPUT_TOKEN_MAX,
      )

    const tools = await resolveTools(input)

    l.info("streamText call", {
      messageCount: input.messages.length,
      toolCount: Object.keys(tools).length,
      systemCount: system.length,
    })

    const messages: CoreMessage[] = [
      ...(isCodex
        ? [
          {
            role: "user",
            content: system.join("\n\n"),
          } as CoreMessage,
        ]
        : system.map(
          (x, i, arr): CoreMessage => ({
            role: "system",
            content: x,
            // @ts-ignore
            experimental_providerMetadata:
              input.model.providerID.includes("anthropic") && i === arr.length - 1
                ? { anthropic: { cacheControl: { type: "ephemeral" } } }
                : undefined,
          }),
        )),
      ...input.messages,
    ]

    l.debug("streamText messages", { messages })

    return streamText({
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }

        // Try fuzzy matching instead of falling back to invalid
        const toolNames = Object.keys(tools)
        const bestMatch = toolNames.find(name =>
          name.toLowerCase() === lower ||
          name.includes(lower) ||
          lower.includes(name)
        )

        if (bestMatch) {
          l.info("fuzzy repaired tool call", { original: failed.toolCall.toolName, repaired: bestMatch })
          return { ...failed.toolCall, toolName: bestMatch }
        }

        // Return error instead of invalid tool
        throw new Error(`Unknown tool: ${failed.toolCall.toolName}`)
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(isCodex
          ? {
            originator: "navi",
            "User-Agent": `navi/${Installation.VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
            session_id: input.sessionID,
          }
          : undefined),
        ...(input.model.providerID.startsWith("navi")
          ? {
            "x-navi-project": Instance.project.id,
            "x-navi-session": input.sessionID,
            "x-navi-request": input.user.id,
            "x-navi-client": Flag.NAVI_CLIENT,
          }
          : undefined),
        ...input.model.headers,
      },
      maxRetries: input.retries ?? 0,
      messages,
      model: language,
      experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
    })
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }
}
