import { ProviderLoader } from "../loader"
import { Env } from "../../env"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Log } from "../../util/log"

const log = Log.create({ service: "kilocode-provider" })

export const KilocodeProvider: ProviderLoader.Info = {
    async load(input) {
        // input may be undefined if kilocode is not in models.dev
        const inputId = input?.id ?? "kilocode"
        const inputEnv = input?.env ?? []
        const inputModels = input?.models ?? {}

        // Get the auth token from various sources
        const auth = await Auth.get(inputId)
        const env = Env.all()
        const config = await Config.get()

        // Check for API key from various sources
        const apiKey = (() => {
            // First check environment variables
            const envKey = inputEnv.map((item) => env[item]).find(Boolean)
            if (envKey) return envKey

            // Then check auth (OAuth or API key)
            if (auth) {
                if (auth.type === "oauth") return auth.access
                if (auth.type === "api") return auth.key
            }

            // Finally check config
            if (config.provider?.["kilocode"]?.options?.apiKey) {
                return config.provider["kilocode"].options.apiKey
            }

            return undefined
        })()

        const hasKey = !!apiKey

        log.info("loading", { hasKey, inputId })

        let models = { ...inputModels }
        let fetchedModels = false

        try {
            const fetchHeaders: Record<string, string> = {
                "HTTP-Referer": "https://kilocode.ai",
                "X-Title": "Kilo Code",
                "X-KiloCode-Source": "navi",
            }
            if (apiKey && apiKey !== "public") {
                fetchHeaders["Authorization"] = `Bearer ${apiKey}`
            }
            const res = await fetch("https://api.kilo.ai/api/openrouter/models", {
                headers: fetchHeaders,
                signal: AbortSignal.timeout(8_000),
            })
            if (res.ok) {
                const data = (await res.json()) as any
                if (data && data.data && Array.isArray(data.data)) {
                    const fetched: typeof models = {}
                    for (const model of data.data) {
                        const inputPrice = Number(model.pricing?.prompt || 0)
                        const outputPrice = Number(model.pricing?.completion || 0)
                        const isImage = model.architecture?.input_modalities?.includes("image") || false
                        const isReasoning = model.supported_parameters?.includes("reasoning") || false
                        fetched[model.id] = {
                            id: model.id,
                            providerID: "kilocode",
                            name: model.name,
                            api: {
                                id: model.id,
                                url: "https://api.kilo.ai/api/openrouter/",
                                npm: "@ai-sdk/openai-compatible",
                            },
                            status: "active",
                            capabilities: {
                                temperature: model.supported_parameters?.includes("temperature") || false,
                                reasoning: isReasoning,
                                attachment: isImage,
                                toolcall: model.supported_parameters?.includes("tools") || false,
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
                                context: model.context_length || 128000,
                                output: model.top_provider?.max_completion_tokens || 8192
                            },
                            options: {},
                            headers: {},
                            release_date: new Date().toISOString(),
                            isFree: inputPrice === 0 || model.id.endsWith(":free"),
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

        // If no API key, filter to only free models
        if (!hasKey) {
            for (const [key, value] of Object.entries(models)) {
                if (value.cost?.input === 0 || value.id.endsWith(":free")) continue
                delete models[key]
            }
        }

        const modelCount = Object.keys(models).length

        // autoload if: we have an API key (even if fetch failed, we want it visible)
        // OR if we have free static models to show
        const autoload = hasKey || modelCount > 0

        log.info("done", { autoload, modelCount, fetchedModels, hasKey })

        return {
            autoload,
            options: {
                apiKey: apiKey || "public",
                baseURL: "https://api.kilo.ai/api/openrouter/",
                headers: {
                    "HTTP-Referer": "https://kilocode.ai",
                    "X-Title": "Kilo Code",
                    "X-KiloCode-Source": "navi",
                },
            },
            models,
        }
    },
}


