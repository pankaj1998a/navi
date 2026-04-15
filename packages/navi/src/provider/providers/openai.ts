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

const PREFERRED_OPENAI_PREFIXES = [
    "gpt-5.4",
    "gpt-5.3",
    "gpt-5.2",
    "gpt-5.1",
    "gpt-5",
    "gpt-4.1",
    "gpt-4o",
    "o4",
    "o3",
    "o1",
    "chatgpt-",
    "codex-",
]

function isLangModel(id: string): boolean {
    const excludedPrefixes = [
        "text-embedding-",
        "embedding-",
        "moderation-",
        "whisper-",
        "tts-",
        "dall-e",
        "gpt-image-",
        "image-",
        "sora-",
    ]
    return !excludedPrefixes.some((p) => id.startsWith(p))
}

function getOpenAIRank(id: string): number {
    const index = PREFERRED_OPENAI_PREFIXES.findIndex((p) => id.startsWith(p))
    return index === -1 ? PREFERRED_OPENAI_PREFIXES.length : index
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
                const orderedStamped = Object.fromEntries(
                    Object.entries(stamped).sort(([a], [b]) => {
                        const rankDiff = getOpenAIRank(a) - getOpenAIRank(b)
                        return rankDiff !== 0 ? rankDiff : a.localeCompare(b)
                    }),
                )
                models = orderedStamped
                await writeCache(PROVIDER_ID, orderedStamped)
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


