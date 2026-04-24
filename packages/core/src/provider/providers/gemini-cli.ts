import { ProviderLoader } from "../loader"
import { Log } from "../../util/log"

const log = Log.create({ service: "gemini-cli-provider" })

export const GeminiCliProvider: ProviderLoader.Info = {
    async load() {
        const { GEMINI_MODELS, GEMINI_API_URL, getAccessToken, resolveGeminiModelID } = await import("../gemini-cli")

        // Use getAccessToken which internally calls getGeminiAuth() and handles
        // the ~/.gemini/oauth_creds.json fallback from the official gemini-cli tool
        const token = await getAccessToken()

        log.info("GeminiCliProvider.load: checking auth", {
            hasToken: !!token,
        })

        if (!token) {
            // No auth found — do not autoload (provider hidden until user logs in)
            return {
                autoload: false,
                options: {},
                async getModel(sdk: any, modelID: string) {
                    const modelConfig = GEMINI_MODELS[modelID as keyof typeof GEMINI_MODELS]
                    return sdk.languageModel(resolveGeminiModelID(modelConfig?.id ?? modelID))
                },
            }
        }

        return {
            autoload: true,
            async getModel(sdk: any, modelID: string) {
                const modelConfig = GEMINI_MODELS[modelID as keyof typeof GEMINI_MODELS]
                return sdk.languageModel(resolveGeminiModelID(modelConfig?.id ?? modelID))
            },
            options: {
                apiKey: "no-key",
                baseURL: GEMINI_API_URL,
                fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                    const { geminiCliFetch } = await import("../gemini-cli")
                    return geminiCliFetch(input, init)
                },
            },
        }
    },
}


