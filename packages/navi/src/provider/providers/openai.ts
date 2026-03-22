import { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { loadCachedModels, stampCatalog, writeCache } from "../model-cache"
import { fetchOpenAICompatibleModels } from "../fetch-models"
import { Log } from "../../util/log"

const PROVIDER_ID = "openai"
const BASE_URL = "https://api.openai.com/v1"
const NPM = "@ai-sdk/openai"
const log = Log.create({ service: "openai-provider" })

/** Model id prefixes that indicate a language / chat model worth listing */
const LANG_MODEL_PREFIXES = [
    "gpt-",
    "o1",
    "o3",
    "o4",
    "chatgpt-",
    "codex-",
]

function isLangModel(id: string): boolean {
    return LANG_MODEL_PREFIXES.some((p) => id.startsWith(p))
}

export const OpenAIProvider: ProviderLoader.Info = {
    async load(input) {
        const env = Env.all()
        const envKey = (input?.env ?? ["OPENAI_API_KEY"]).map((k) => env[k]).find(Boolean)
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
                    // Only include chat / language / reasoning models
                    if (!isLangModel(raw.id)) return undefined

                    const isReasoning = raw.id.startsWith("o1") || raw.id.startsWith("o3") || raw.id.startsWith("o4")
                    const isVision = raw.id.includes("vision") || raw.id.includes("-o") || raw.id.includes("4o") || raw.id.includes("4.1") || raw.id.includes("5")

                    return {
                        capabilities: {
                            temperature: !isReasoning,
                            reasoning: isReasoning,
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
            } else if (cacheState.cache) {
                models = cacheState.models
                log.warn("using cached OpenAI models after fetch failure", {
                    providerID: PROVIDER_ID,
                    stale: cacheState.stale,
                    ageMs: cacheState.cache.ageMs,
                })
            }
        }

        return {
            autoload: hasKey,
            // Use the Responses API (stateful) for all OpenAI models
            async getModel(sdk: any, modelID: string) {
                return sdk.responses(modelID)
            },
            options: {},
            models: hasKey ? models : {},
        }
    },
}
