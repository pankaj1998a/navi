import { ProviderLoader } from "../loader"
import { Env } from "../../env"
import { Auth } from "../../auth"
import { Config } from "../../config/config"

export const OpencodeProvider: ProviderLoader.Info = {
    async load(input) {
        if (!input) return { autoload: false, options: {} }

        // Load all available keys
        const getKeys = async () => {
            const keys: string[] = []

            // Check comma-separated env vars
            const envKeys = Env.get("OPENCODE_API_KEYS") ?? Env.get("OPENCODE_API_KEY")
            if (envKeys) {
                keys.push(...envKeys.split(",").map(k => k.trim()).filter(Boolean))
            }

            // Check Auth
            const auth = await Auth.get(input.id)
            if (auth?.type === "api" && auth.key) {
                keys.push(auth.key)
            }

            // Check Config
            const config = await Config.get()
            const configKey = config.provider?.["opencode"]?.options?.apiKey
            if (configKey) {
                keys.push(configKey)
            }

            return [...new Set(keys)] // Deduplicate
        }

        const keys = await getKeys()
        const hasKey = keys.length > 0

        // Default to "public" if no keys found, but treat it as a valid key for rotation context
        const rotationKeys = hasKey ? keys : ["public"]

        const models = { ...input.models }

        if (!hasKey) {
            for (const [key, value] of Object.entries(models)) {
                if (value.cost?.input === 0) continue
                delete models[key]
            }
        }

        // Define model fallbacks for rate limits
        const FALLBACKS: Record<string, string> = {
            "kimi-k2.5-free": "gpt-5-nano",
            "kimi-k2.5": "gpt-5-nano",
            "gpt-5-nano": "kimi-k2.5-free",
            "gpt-5-mini": "kimi-k2.5-free"
        }

        let currentKeyIndex = 0

        const customFetch = async (url: string | URL | Request, init?: RequestInit) => {
            const maxRetries = 3
            let lastError: Response | null = null

            for (let i = 0; i < maxRetries; i++) {
                const key = rotationKeys[currentKeyIndex]

                const headers = new Headers(init?.headers)
                headers.set("Authorization", `Bearer ${key}`)
                // Always overwrite these headers to mimic OpenCode CLI
                headers.set("HTTP-Referer", "https://opencode.ai/")
                headers.set("X-Title", "OpenCode")
                if (!headers.has("User-Agent")) headers.set("User-Agent", "opencode/1.0")

                let currentInit = { ...init, headers }

                // Try to parse body and force fallback if needed
                let bodyObj: any = null
                if (init?.body && typeof init.body === "string") {
                    try {
                        bodyObj = JSON.parse(init.body)
                    } catch (e) { /* ignore */ }
                }

                if (i === maxRetries - 1 && bodyObj && bodyObj.model && FALLBACKS[bodyObj.model]) {
                    const newModel = FALLBACKS[bodyObj.model]
                    // console.warn(`[Opencode] Rate limit hit. Falling back from ${bodyObj.model} to ${newModel}`)
                    bodyObj.model = newModel
                    currentInit = { ...currentInit, body: JSON.stringify(bodyObj) }
                }

                const response = await fetch(url, currentInit)

                if (response.status === 429 || response.status === 401 || response.status === 403) {
                    lastError = response
                    // Rate limit -> Rotate key
                    currentKeyIndex = (currentKeyIndex + 1) % rotationKeys.length

                    if (i < maxRetries - 1) {
                        const delay = 1000
                        await new Promise(resolve => setTimeout(resolve, delay))
                    }
                    continue
                }

                return response
            }

            // Return the last error response if retries exhausted
            return lastError || new Response("Rate limit exceeded", { status: 429 })
        }

        return {
            autoload: Object.keys(models).length > 0,
            options: {
                apiKey: rotationKeys[0], // Pass first key to SDK, but fetch will override
                fetch: customFetch,
            },
            models,
        }
    },
}
