import type { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { loadCachedModels, stampCatalog, writeCache } from "../model-cache"
import { fetchOpenAICompatibleModels } from "../fetch-models"

const PROVIDER_ID = "xai"
const BASE_URL = "https://api.x.ai/v1"
const NPM = "@ai-sdk/xai"

export const XaiProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const env = dep.env
        const envKey = (input?.env ?? ["XAI_API_KEY"]).map((k) => env[k]).find(Boolean)
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
                    const isImage = raw.id?.includes("vision") || (raw.input_modalities ?? []).includes("image")
                    const isReasoning = raw.id?.includes("think") || raw.id?.includes("reason")
                    return {
                        capabilities: {
                            temperature: !isReasoning,
                            reasoning: isReasoning,
                            attachment: isImage,
                            toolcall: true,
                            input: { text: true, audio: false, image: isImage, video: false, pdf: false },
                            output: { text: true, audio: false, image: false, video: false, pdf: false },
                            interleaved: false,
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


