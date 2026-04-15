import { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Log } from "../../util/log"

const log = Log.create({ service: "provider-google-antigravity" })

// @ai-sdk/google needs this base URL to build model URLs
// Our antigravityFetch intercepts those URLs and routes to cloudcode-pa.googleapis.com
const GOOGLE_GENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

export const GoogleAntigravityProvider: ProviderLoader.Info = {
    async load() {
        const { ANTIGRAVITY_MODELS, getAccessToken, antigravityFetch } = await import("../antigravity")

        const auth = await Auth.get("google-antigravity")
        const hasValidAuth = auth && auth.type === "oauth"

        if (!hasValidAuth) {
            log.info("No valid OAuth authentication found for Antigravity — provider available but inactive")
            return {
                autoload: false,
                options: {},
                async getModel(sdk: any, modelID: string) {
                    const modelConfig = ANTIGRAVITY_MODELS[modelID as keyof typeof ANTIGRAVITY_MODELS]
                    const apiModelId = modelConfig?.id ?? modelID
                    return sdk.languageModel(apiModelId)
                },
            }
        }

        const testToken = await getAccessToken()
        if (!testToken) {
            log.warn("Failed to get Antigravity access token")
            return {
                autoload: false,
                options: {},
                async getModel(sdk: any, modelID: string) {
                    const modelConfig = ANTIGRAVITY_MODELS[modelID as keyof typeof ANTIGRAVITY_MODELS]
                    const apiModelId = modelConfig?.id ?? modelID
                    return sdk.languageModel(apiModelId)
                },
            }
        }

        return {
            autoload: true,
            async getModel(sdk: any, modelID: string) {
                const modelConfig = ANTIGRAVITY_MODELS[modelID as keyof typeof ANTIGRAVITY_MODELS]
                const apiModelId = modelConfig?.id ?? modelID
                return sdk.languageModel(apiModelId)
            },
            options: {
                apiKey: "no-key",
                // Use generativelanguage.googleapis.com so @ai-sdk/google constructs standard URLs
                // like /v1beta/models/{model}:streamGenerateContent that antigravityFetch can parse.
                // antigravityFetch then routes to cloudcode-pa.googleapis.com with Code Assist format.
                baseURL: GOOGLE_GENAI_BASE_URL,
                fetch: antigravityFetch,
            },
        }
    },
}


