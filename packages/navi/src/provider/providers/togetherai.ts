import type { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { loadCachedModels, stampCatalog, writeCache } from "../model-cache"
import { fetchOpenAICompatibleModels } from "../fetch-models"

const PROVIDER_ID = "togetherai"
const BASE_URL = "https://api.together.xyz/v1"
const NPM = "@ai-sdk/togetherai"

export const TogetherAIProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const env = dep.env
        const envKey = (input?.env ?? ["TOGETHER_API_KEY", "TOGETHERAI_API_KEY"]).map((k) => env[k]).find(Boolean)
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
                    // Together returns: { id, display_name, context_length, type, pricing, config }
                    const inputPrice = Number(raw.pricing?.input ?? raw.pricing?.base ?? 0) / 1_000_000
                    const outputPrice = Number(raw.pricing?.output ?? 0) / 1_000_000
                    const inputModals: string[] = raw.config?.method === "multimodal" ? ["image"] : []
                    const isImage = inputModals.includes("image")

                    // Only include chat / language models
                    if (raw.type && !["chat", "language", "code", "multimodal"].includes(raw.type)) {
                        return undefined
                    }

                    return {
                        name: raw.display_name ?? raw.id,
                        capabilities: {
                            temperature: true,
                            reasoning: false,
                            attachment: isImage,
                            toolcall: true,
                            input: { text: true, audio: false, image: isImage, video: false, pdf: false },
                            output: { text: true, audio: false, image: false, video: false, pdf: false },
                            interleaved: false,
                        },
                        cost: {
                            input: inputPrice,
                            output: outputPrice,
                            cache: { read: 0, write: 0 },
                        },
                        limit: { context: raw.context_length ?? 0, output: 0 },
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


