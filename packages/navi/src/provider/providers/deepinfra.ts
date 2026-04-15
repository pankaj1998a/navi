import { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { loadCachedModels, stampCatalog, writeCache } from "../model-cache"
import { fetchOpenAICompatibleModels } from "../fetch-models"

const PROVIDER_ID = "deepinfra"
const BASE_URL = "https://api.deepinfra.com/v1/openai"
const NPM = "@ai-sdk/deepinfra"

export const DeepInfraProvider: ProviderLoader.Info = {
    async load(input) {
        const env = Env.all()
        const envKey = (input?.env ?? ["DEEPINFRA_API_KEY"]).map((k) => env[k]).find(Boolean)
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
                    const isVision = raw.id?.includes("vision") || raw.id?.includes("vl")
                    return {
                        capabilities: {
                            temperature: true,
                            reasoning: false,
                            attachment: isVision,
                            toolcall: true,
                            input: { text: true, audio: false, image: isVision, video: false, pdf: false },
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


