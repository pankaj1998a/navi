import type { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { loadCachedModels, stampCatalog, writeCache } from "../model-cache"
import { fetchOpenAICompatibleModels } from "../fetch-models"

const PROVIDER_ID = "groq"
const BASE_URL = "https://api.groq.com/openai/v1"
const NPM = "@ai-sdk/groq"

export const GroqProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const env = dep.env
        const envKey = (input?.env ?? ["GROQ_API_KEY"]).map((k) => env[k]).find(Boolean)
        const auth = await dep.auth(PROVIDER_ID)
        const config = dep.config
        const apiKey = envKey ?? (auth?.type === "api" ? auth.key : undefined) ?? config.provider?.[PROVIDER_ID]?.options?.apiKey

        const hasKey = !!apiKey

        // Try live fetch when we have a key, fall back to cache, then to models.dev data
        const cacheState = await loadCachedModels(PROVIDER_ID, input?.models ? { ...input.models } : {})
        let models = cacheState.models

        if (hasKey) {
            const fetched = await fetchOpenAICompatibleModels({
                providerID: PROVIDER_ID,
                url: `${BASE_URL}/models`,
                apiKey,
                baseURL: BASE_URL,
                npm: NPM,
                transform(raw) {
                    return {
                        capabilities: {
                            temperature: true,
                            reasoning: raw.id?.includes("reasoning") ?? false,
                            attachment: false,
                            toolcall: true,
                            input: { text: true, audio: false, image: false, video: false, pdf: false },
                            output: { text: true, audio: false, image: false, video: false, pdf: false },
                            interleaved: false,
                        },
                        limit: {
                            context: raw.context_window ?? 0,
                            output: raw.max_tokens ?? 0,
                        },
                    }
                },
            })
            if (fetched) {
                const stamped = stampCatalog(fetched, {
                    providerID: PROVIDER_ID,
                    source: "fetch",
                    fetchedAt: new Date().toISOString(),
                })
                models = stamped
                await writeCache(PROVIDER_ID, stamped)
            }
        }

        return {
            autoload: hasKey,
            options: {},
            models: hasKey ? models : {},
        }
    },
}


