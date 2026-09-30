import type { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { loadCachedModels, stampCatalog, writeCache } from "../model-cache"
import { fetchOpenAICompatibleModels } from "../fetch-models"

const PROVIDER_ID = "mistral"
const BASE_URL = "https://api.mistral.ai/v1"
const NPM = "@ai-sdk/mistral"

export const MistralProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const env = dep.env
        const envKey = (input?.env ?? ["MISTRAL_API_KEY"]).map((k) => env[k]).find(Boolean)
        const auth = await dep.auth(PROVIDER_ID)
        const config = dep.config
        const apiKey = envKey ?? (auth?.type === "api" ? auth.key : undefined) ?? config.provider?.[PROVIDER_ID]?.options?.apiKey

        const hasKey = !!apiKey

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
                    // Mistral schema: { id, name, max_context_length, deprecation?, capabilities? }
                    return {
                        name: raw.name ?? raw.id,
                        capabilities: {
                            temperature: true,
                            reasoning: false,
                            attachment: raw.capabilities?.vision ?? false,
                            toolcall: raw.capabilities?.function_calling ?? true,
                            input: {
                                text: true,
                                audio: false,
                                image: raw.capabilities?.vision ?? false,
                                video: false,
                                pdf: false,
                            },
                            output: { text: true, audio: false, image: false, video: false, pdf: false },
                            interleaved: false,
                        },
                        limit: {
                            context: raw.max_context_length ?? 0,
                            output: 0,
                        },
                        status: raw.deprecation ? "deprecated" : "active",
                    }
                },
            })
            if (fetched) {
                // Remove deprecated models from cache
                for (const [k, v] of Object.entries(fetched)) {
                    if (v.status === "deprecated") delete fetched[k]
                }
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


