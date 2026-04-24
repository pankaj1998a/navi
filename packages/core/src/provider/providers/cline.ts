import { ProviderLoader } from "../loader"
import { Env } from "../../env"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Log } from "../../util/log"
import { ModelID, ProviderID } from "../schema"

const log = Log.create({ service: "cline-provider" })

const CLINE_BASE_URL = "https://api.cline.bot/api/v1"

export const ClineProvider: ProviderLoader.Info = {
    async load(input) {
        const inputId = input?.id ?? "cline"
        const inputEnv = input?.env ?? []
        const inputModels = input?.models ?? {}

        const auth = await Auth.get(inputId)
        const env = Env.all()
        const config = await Config.get()

        const apiKey = (() => {
            const envKey = inputEnv.map((item) => env[item]).find(Boolean)
            if (envKey) return envKey

            if (auth) {
                if (auth.type === "oauth") return auth.access
                if (auth.type === "api") return auth.key
            }

            if (config.provider?.["cline"]?.options?.apiKey) {
                return config.provider["cline"].options.apiKey
            }

            return undefined
        })()

        const hasKey = !!apiKey

        log.info("loading", { hasKey, inputId })

        let models = { ...inputModels }
        let fetchedModels = false

        if (hasKey) {
            try {
                const fetchHeaders: Record<string, string> = {
                    "HTTP-Referer": "https://cline.bot",
                    "X-Title": "Cline",
                    "Authorization": `Bearer ${apiKey}`,
                }
                const res = await fetch(`${CLINE_BASE_URL}/models`, {
                    headers: fetchHeaders,
                    signal: AbortSignal.timeout(8_000),
                })
                if (res.ok) {
                    const data = (await res.json()) as any
                    if (data && data.data && Array.isArray(data.data)) {
                        const fetched: typeof models = {}
                        for (const model of data.data) {
                            const modelId = model.id as string
                            const inputPrice = Number(model.pricing?.input || model.pricing?.prompt || 0)
                            const outputPrice = Number(model.pricing?.output || model.pricing?.completion || 0)
                            const isImage = model.id.includes("vision") || model.id.includes("gpt-4o") || model.id.includes("claude-3") || model.architecture?.input_modalities?.includes("image") || false
                            const isReasoning = model.id.includes("reasoning") || model.id.includes("o1") || model.id.includes("o3") || model.supported_parameters?.includes("reasoning") || false
                            fetched[modelId] = {
                                id: ModelID.make(modelId),
                                providerID: ProviderID.make("cline"),
                                name: model.name || modelId,
                                api: {
                                    id: modelId,
                                    url: CLINE_BASE_URL,
                                    npm: "@ai-sdk/openai-compatible",
                                },
                                status: "active",
                                capabilities: {
                                    temperature: model.supported_parameters ? model.supported_parameters.includes("temperature") : true,
                                    reasoning: isReasoning,
                                    attachment: isImage,
                                    toolcall: model.supported_parameters ? model.supported_parameters.includes("tools") : true,
                                    input: {
                                        text: true,
                                        audio: false,
                                        image: isImage,
                                        video: false,
                                        pdf: false,
                                    },
                                    output: {
                                        text: true,
                                        audio: false,
                                        image: false,
                                        video: false,
                                        pdf: false,
                                    },
                                    interleaved: false,
                                },
                                cost: { input: inputPrice, output: outputPrice, cache: { read: 0, write: 0 } },
                                limit: {
                                    context: model.context_window || model.context_length || 128000,
                                    output: model.max_tokens || model.top_provider?.max_completion_tokens || 8192
                                },
                                options: {},
                                headers: {},
                                release_date: new Date().toISOString(),
                                variants: {}
                            }
                        }
                        models = fetched
                        fetchedModels = true
                        log.info("fetched models from API", { count: Object.keys(fetched).length })
                    }
                } else {
                    const errText = await res.text().catch(() => "")
                    log.error("failed to fetch models", new Error(`HTTP ${res.status}: ${errText}`))
                }
            } catch (error) {
                log.error("fetch models threw", error as Error)
            }
        }

        // If no API key, filter to only free models
        if (!hasKey) {
            for (const [key, value] of Object.entries(models)) {
                if (value.cost?.input === 0 || value.id.endsWith(":free")) continue
                delete models[key]
            }
        }

        const modelCount = Object.keys(models).length
        const autoload = hasKey || modelCount > 0

        log.info("done", { autoload, modelCount, fetchedModels, hasKey })

        return {
            autoload,
            options: {
                apiKey: apiKey || "public",
                baseURL: CLINE_BASE_URL,
                headers: {
                    "HTTP-Referer": "https://cline.bot",
                    "X-Title": "Cline",
                },
            },
            models,
        }
    },
}


