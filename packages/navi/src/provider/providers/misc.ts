import type { ProviderLoader } from "../loader"
import { Env } from "../../env"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "openrouter-provider" })

export const OpenrouterProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const inputId = input?.id ?? "openrouter"
        const inputEnv = input?.env ?? ["OPENROUTER_API_KEY"]
        const inputModels = input?.models ?? {}

        const auth = await dep.auth(inputId)
        const env = dep.env
        const config = dep.config

        const apiKey = (() => {
            const envKey = inputEnv.map((item) => env[item]).find(Boolean)
            if (envKey) return envKey

            if (auth) {
                if (auth.type === "oauth") return auth.access
                if (auth.type === "api") return auth.key
            }

            if (config.provider?.[inputId]?.options?.apiKey) {
                return config.provider[inputId].options.apiKey
            }

            return undefined
        })()

        const hasKey = !!apiKey

        log.info("loading", { hasKey, inputId })

        let models = { ...inputModels }
        let fetchedModels = false

        try {
            const fetchHeaders: Record<string, string> = {
                "HTTP-Referer": "https://navi.ai/",
                "X-Title": "navi",
            }
            if (apiKey) {
                fetchHeaders["Authorization"] = `Bearer ${apiKey}`
            }
            const res = await fetch("https://openrouter.ai/api/v1/models", {
                headers: fetchHeaders,
                signal: AbortSignal.timeout(8_000),
            })
            if (res.ok) {
                const data = (await res.json()) as any
                if (data && data.data && Array.isArray(data.data)) {
                    const fetched: typeof models = {}
                    for (const model of data.data) {
                        const inputPrice = Number(model.pricing?.prompt ?? model.pricing?.input ?? 0)
                        const outputPrice = Number(model.pricing?.completion ?? model.pricing?.output ?? 0)
                        const cacheRead = Number(model.pricing?.input_cache_read ?? model.pricing?.cache_read ?? 0)
                        const cacheWrite = Number(model.pricing?.input_cache_write ?? model.pricing?.cache_write ?? 0)
                        const inputModalities = model.architecture?.input_modalities ?? []
                        const outputModalities = model.architecture?.output_modalities ?? []
                        const supported = model.supported_parameters ?? []
                        const attachment = inputModalities.some((item: string) =>
                            ["image", "audio", "video", "pdf"].includes(item),
                        )
                        fetched[model.id] = {
                            id: model.id,
                            providerID: inputId,
                            name: model.name ?? model.id,
                            api: {
                                id: model.id,
                                url: "https://openrouter.ai/api/v1",
                                npm: "@openrouter/ai-sdk-provider",
                            },
                            status: "active",
                            capabilities: {
                                temperature: supported.includes("temperature"),
                                reasoning: supported.includes("reasoning") || supported.includes("include_reasoning"),
                                attachment,
                                toolcall:
                                    supported.includes("tools") ||
                                    supported.includes("tool_choice") ||
                                    supported.includes("functions"),
                                input: {
                                    text: inputModalities.includes("text") || inputModalities.length === 0,
                                    audio: inputModalities.includes("audio"),
                                    image: inputModalities.includes("image"),
                                    video: inputModalities.includes("video"),
                                    pdf: inputModalities.includes("pdf"),
                                },
                                output: {
                                    text: outputModalities.includes("text") || outputModalities.length === 0,
                                    audio: outputModalities.includes("audio"),
                                    image: outputModalities.includes("image"),
                                    video: outputModalities.includes("video"),
                                    pdf: outputModalities.includes("pdf"),
                                },
                                interleaved: false,
                            },
                            cost: {
                                input: inputPrice,
                                output: outputPrice,
                                cache: {
                                    read: cacheRead,
                                    write: cacheWrite,
                                },
                            },
                            limit: {
                                context: model.context_length ?? model.top_provider?.context_length ?? 0,
                                output: model.top_provider?.max_completion_tokens ?? 0,
                            },
                            options: {},
                            headers: {},
                            release_date: new Date().toISOString(),

                            variants: {},
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

        if (!hasKey) {
            for (const [key, value] of Object.entries(models)) {
                if (value.cost?.input === 0 && value.cost?.output === 0) continue
                if (value.id.endsWith(":free")) continue
                delete models[key]
            }
        }


        const modelCount = Object.keys(models).length
        const autoload = hasKey || modelCount > 0

        log.info("done", { autoload, modelCount, fetchedModels, hasKey })

        return {
            autoload,
            options: {
                apiKey: apiKey ?? "public",
                baseURL: "https://openrouter.ai/api/v1",
                headers: {
                    "HTTP-Referer": "https://navi.ai/",
                    "X-Title": "navi",
                },
            },
            models,
        }
    },
}

export const VercelProvider: ProviderLoader.Info = {
    async load(input, dep) {
        return {
            autoload: false,
            options: {
                headers: {
                    "http-referer": "https://navi.ai/",
                    "x-title": "navi",
                },
            },
        }
    },
}

export const AihubmixProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const inputId = input?.id ?? "aihubmix"
        const inputEnv = input?.env ?? ["AIHUBMIX_API_KEY"]
        const inputModels = input?.models ?? {}

        const auth = await dep.auth(inputId)
        const env = dep.env
        const config = dep.config

        const apiKey = (() => {
            const envKey = inputEnv.map((item) => env[item]).find(Boolean)
            if (envKey) return envKey

            if (auth) {
                if (auth.type === "oauth") return auth.access
                if (auth.type === "api") return auth.key
            }

            if (config.provider?.[inputId]?.options?.apiKey) {
                return config.provider[inputId].options.apiKey
            }

            return undefined
        })()

        const hasKey = !!apiKey

        log.info("loading aihubmix", { hasKey, inputId })

        let models = { ...inputModels }
        let fetchedModels = false

        try {
            const fetchHeaders: Record<string, string> = {
                "HTTP-Referer": "https://navi.ai/",
                "X-Title": "navi",
            }
            if (apiKey) {
                fetchHeaders["Authorization"] = `Bearer ${apiKey}`
            }
            const res = await fetch("https://aihubmix.com/api/v1/models", {
                headers: fetchHeaders,
                signal: AbortSignal.timeout(8_000),
            })
            if (res.ok) {
                const data = (await res.json()) as any
                if (data && data.data && Array.isArray(data.data)) {
                    const fetched: typeof models = {}
                    for (const model of data.data) {
                        const inputPrice = Number(model.pricing?.input ?? 0)
                        const outputPrice = Number(model.pricing?.output ?? 0)
                        const cacheRead = Number(model.pricing?.cache_read ?? 0)
                        const cacheWrite = Number(model.pricing?.cache_write ?? 0)
                        const inputModalities = typeof model.input_modalities === 'string' ? model.input_modalities.split(',') : []
                        const features = typeof model.features === 'string' ? model.features.split(',') : []

                        const attachment = inputModalities.some((item: string) =>
                            ["image", "audio", "video", "pdf"].includes(item.trim()),
                        )
                        fetched[model.model_id] = {
                            id: model.model_id,
                            providerID: inputId,
                            name: model.model_name ?? model.model_id,
                            api: {
                                id: model.model_id,
                                url: "https://api.aihubmix.com/v1",
                                npm: "@ai-sdk/openai-compatible",
                            },
                            status: "active",
                            capabilities: {
                                temperature: true,
                                reasoning: features.includes("thinking"),
                                attachment,
                                toolcall: features.includes("tools") || features.includes("function_calling"),
                                input: {
                                    text: inputModalities.includes("text") || inputModalities.length === 0,
                                    audio: inputModalities.includes("audio"),
                                    image: inputModalities.includes("image"),
                                    video: inputModalities.includes("video"),
                                    pdf: inputModalities.includes("pdf"),
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
                            cost: {
                                input: inputPrice,
                                output: outputPrice,
                                cache: {
                                    read: cacheRead,
                                    write: cacheWrite,
                                },
                            },
                            limit: {
                                context: model.context_length ?? 0,
                                output: model.max_output ?? 0,
                            },
                            options: {},
                            headers: {},
                            release_date: new Date().toISOString(),

                            variants: {},
                        }
                    }
                    models = fetched
                    fetchedModels = true
                    log.info("fetched aihubmix models from API", { count: Object.keys(fetched).length })
                }
            } else {
                const errText = await res.text().catch(() => "")
                log.error("failed to fetch aihubmix models", new Error(`HTTP ${res.status}: ${errText}`))
            }
        } catch (error) {
            log.error("fetch aihubmix models threw", error as Error)
        }

        if (!hasKey) {
            for (const [key, value] of Object.entries(models)) {
                if (value.cost?.input === 0 && value.cost?.output === 0) continue
                if (value.id.endsWith(":free")) continue
                delete models[key]
            }
        }

        const modelCount = Object.keys(models).length
        const autoload = hasKey || modelCount > 0

        log.info("done", { autoload, modelCount, fetchedModels, hasKey })

        return {
            autoload,
            options: {
                apiKey: apiKey ?? "public",
                baseURL: "https://api.aihubmix.com/v1",
                headers: {
                    "HTTP-Referer": "https://navi.ai/",
                    "X-Title": "navi",
                },
            },
            models,
        }
    },
}




