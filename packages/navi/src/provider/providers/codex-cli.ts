import type { ProviderLoader } from "../loader"
import * as Log from "@navi-ai/core/util/log"
import { ModelID, ProviderID } from "../schema"
import { detectCodexCliAuth } from "../../plugin/codex"

const log = Log.create({ service: "codex-cli-provider" })

const CODEX_MODELS = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-6-astra", name: "GPT-6 Astra (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-6-luna", name: "GPT-6 Luna (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-daybreak-blue-latest", name: "GPT Daybreak Blue (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-daybreak-red-latest", name: "GPT Daybreak Red (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-6-sol", name: "GPT-6 Sol (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna (Codex CLI)", context: 272000, output: 128000, reasoning: true },
  { id: "gpt-5.5", name: "GPT-5.5 (Codex CLI)", context: 400000, output: 128000, reasoning: true },
  { id: "gpt-5.4", name: "GPT-5.4 (Codex CLI)", context: 272000, output: 128000, reasoning: true },
]

export const CodexCliProvider: ProviderLoader.Info = {
  async load(input, dep) {
    const inputId = input?.id ?? "codex-cli"
    const inputModels = input?.models ?? {}

    const auth = (await dep.auth(inputId)) || (await dep.auth("openai")) || (await dep.auth("codex"))
    let hasAuth = !!auth

    if (!hasAuth) {
      const detected = await detectCodexCliAuth()
      if (detected?.access_token || detected?.refresh_token) {
        hasAuth = true
        log.info("Detected local Codex CLI auth file")
      }
    }

    const models: Record<string, any> = { ...inputModels }

    for (const m of CODEX_MODELS) {
      const modelID = ModelID.make(m.id)
      if (!models[modelID]) {
        models[modelID] = {
          id: modelID,
          providerID: ProviderID.make(inputId),
          name: m.name,
          api: {
            id: m.id,
            url: "https://chatgpt.com/backend-api/codex/responses",
            npm: "@ai-sdk/openai",
          },
          status: "active",
          capabilities: {
            temperature: false,
            reasoning: m.reasoning,
            attachment: true,
            toolcall: true,
            input: { text: true, audio: false, image: true, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: m.context, output: m.output },
          options: {},
          headers: {},
          release_date: new Date().toISOString(),
          variants: {},
        }
      }
    }

    return {
      autoload: hasAuth,
      async getModel(sdk: any, modelID: string) {
        return sdk.responses(modelID)
      },
      options: {},
      models,
    }
  },
}
