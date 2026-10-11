import type { ProviderLoader } from "../loader"
import * as Log from "@navi-ai/core/util/log"
import { ModelID, ProviderID } from "../schema"
import { detectClaudeCliCredentials } from "../../plugin/claude-cli"

const log = Log.create({ service: "claude-cli-provider" })

const CLAUDE_MODELS = [
  { id: "claude-fable-5-1", name: "Claude Fable 5.1 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-fable-5", name: "Claude Fable 5 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-opus-5", name: "Claude Opus 5 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7 (Claude Code)", context: 200000, reasoning: true },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Claude Code)", context: 200000, reasoning: true },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Claude Code)", context: 1000000, reasoning: true },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Claude Code)", context: 200000, reasoning: false },
]

export const ClaudeCliProvider: ProviderLoader.Info = {
  async load(input, dep) {
    const inputId = input?.id ?? "claude-cli"
    const inputEnv = input?.env ?? ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]
    const inputModels = input?.models ?? {}

    const auth = (await dep.auth(inputId)) || (await dep.auth("anthropic"))
    const env = dep.env
    const config = dep.config

    let apiKey = (() => {
      const envKey = inputEnv.map((item) => env[item]).find(Boolean)
      if (envKey) return envKey

      if (auth) {
        if (auth.type === "api") return auth.key
        if (auth.type === "oauth") return auth.access
      }

      if (config.provider?.[inputId]?.options?.apiKey) {
        return config.provider[inputId].options.apiKey
      }

      return undefined
    })()

    if (!apiKey) {
      const detected = await detectClaudeCliCredentials()
      if (detected?.apiKey) {
        apiKey = detected.apiKey
        log.info("Using detected local Claude Code CLI credentials")
      }
    }

    const hasKey = !!apiKey && apiKey !== "NOT_USED"
    const models: Record<string, any> = { ...inputModels }

    for (const m of CLAUDE_MODELS) {
      const modelID = ModelID.make(m.id)
      if (!models[modelID]) {
        models[modelID] = {
          id: modelID,
          providerID: ProviderID.make(inputId),
          name: m.name,
          api: {
            id: m.id,
            url: "https://api.anthropic.com/v1",
            npm: "@ai-sdk/anthropic",
          },
          status: "active",
          capabilities: {
            temperature: true,
            reasoning: m.reasoning,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: true },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: m.context, output: 64000 },
          options: {},
          headers: {
            "anthropic-beta":
              "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,prompt-caching-2024-07-31",
          },
          release_date: new Date().toISOString(),
          variants: {},
        }
      }
    }

    return {
      autoload: hasKey,
      options: {
        apiKey: apiKey || "NOT_USED",
        headers: {
          "anthropic-beta":
            "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,prompt-caching-2024-07-31",
        },
      },
      models,
    }
  },
}
