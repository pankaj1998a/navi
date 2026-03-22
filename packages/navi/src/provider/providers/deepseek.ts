import { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { loadCachedModels, stampCatalog, writeCache } from "../model-cache"
import { fetchOpenAICompatibleModels } from "../fetch-models"

const PROVIDER_ID = "deepseek"
const BASE_URL = "https://api.deepseek.com"
const NPM = "@ai-sdk/openai-compatible"

export const DeepSeekProvider: ProviderLoader.Info = {
    async load(input) {
        const env = Env.all()
        const envKey = (input?.env ?? ["DEEPSEEK_API_KEY"]).map((k) => env[k]).find(Boolean)
        const auth = await Auth.get(PROVIDER_ID)
        const apiKey = envKey ?? (auth?.type === "api" ? auth.key : undefined)

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
                    const isReasoner = raw.id?.includes("reasoner") || raw.id?.includes("thinking")
                    return {
                        capabilities: {
                            temperature: !isReasoner,
                            reasoning: isReasoner,
                            attachment: false,
                            toolcall: true,
                            input: { text: true, audio: false, image: false, video: false, pdf: false },
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
