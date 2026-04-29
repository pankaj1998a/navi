import { ProviderLoader } from "../loader"
import { Env } from "../../env"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Log } from "../../util/log"
import { Provider } from "../provider"
import { ModelID, ProviderID } from "../schema"

const log = Log.create({ service: "kilocode-provider" })

const FETCH_HEADERS = {
    "HTTP-Referer": "https://kilocode.ai",
    "X-Title": "Kilo Code",
    "X-KiloCode-Source": "navi",
}

const BASE_URL = "https://api.kilo.ai/api/openrouter/"

async function fetchKilocodeModels(apiKey?: string): Promise<Record<string, Provider.Model>> {
    try {
        const headers: Record<string, string> = { ...FETCH_HEADERS }
        if (apiKey && apiKey !== "public") {
            headers["Authorization"] = `Bearer ${apiKey}`
        }
        const res = await fetch("https://api.kilo.ai/api/openrouter/models", {
            headers,
            signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) {
            const text = await res.text().catch(() => "")
            throw new Error(`HTTP ${res.status}: ${text}`)
        }
        const data = (await res.json()) as any
        if (!data || !data.data || !Array.isArray(data.data)) {
            return {}
        }

        const models: Record<string, Provider.Model> = {}
        for (const model of data.data) {
            const inputPrice = Number(model.pricing?.prompt || 0)
            const outputPrice = Number(model.pricing?.completion || 0)
            const isImage = model.architecture?.input_modalities?.includes("image") || false
            const isReasoning = model.supported_parameters?.includes("reasoning") || model.id.includes("deepseek-r1") || model.id.includes("o1") || model.id.includes("o3")
            
            const modelID = ModelID.make(model.id)
            models[modelID] = {
                id: modelID,
                providerID: ProviderID.make("kilocode"),
                name: model.name,
                api: {
                    id: model.id,
                    url: BASE_URL,
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
                    interleaved: isReasoning ? { field: "reasoning_content" } : false,
                },
                cost: { input: inputPrice, output: outputPrice, cache: { read: 0, write: 0 } },
                limit: {
                    context: model.context_length || 128000,
                    output: model.top_provider?.max_completion_tokens || 8192
                },
                options: {},
                headers: {},
                release_date: new Date().toISOString(),
                variants: {}
            }
        }
        return models
    } catch (error) {
        log.error("failed to fetch models", error as Error)
        return {}
    }
}

export const KilocodeProvider: ProviderLoader.Info = {
    async load(input) {
        const inputId = input?.id ?? "kilocode"
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
            if (config.provider?.[inputId]?.options?.apiKey) {
                return config.provider[inputId].options.apiKey
            }
            return undefined
        })()

        const hasKey = !!apiKey
        log.info("loading", { hasKey, inputId })

        let models = { ...inputModels }
        const latest = await fetchKilocodeModels(apiKey)
        if (Object.keys(latest).length > 0) {
            models = { ...models, ...latest }
        }

        const fetchedModels = Object.keys(latest).length > 0

        if (!hasKey) {
            for (const [key, value] of Object.entries(models)) {
                if (value.cost?.input === 0 || value.id.endsWith(":free") || value.id.endsWith("/free")) continue
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
                baseURL: BASE_URL,
                headers: FETCH_HEADERS,
            },
            discoverModels: async () => {
                const latest = await fetchKilocodeModels(apiKey)
                return latest as any
            },
            models,
        }
    },
}


