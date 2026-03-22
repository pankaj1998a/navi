import { ProviderLoader } from "../loader"
import { Auth } from "../../auth"

export const QwenCliProvider: ProviderLoader.Info = {
    async load() {
        const { QWEN_MODELS, QWEN_API_URL } = await import("../qwen-cli")
        const auth = await Auth.get("qwen-cli")

        if (!auth || auth.type !== "oauth") {
            return {
                autoload: true,
                options: {},
                async getModel(sdk: any, modelID: string) {
                    const modelConfig = QWEN_MODELS[modelID as keyof typeof QWEN_MODELS]
                    return sdk.languageModel(modelConfig?.id ?? modelID)
                },
            }
        }

        return {
            autoload: true,
            async getModel(sdk: any, modelID: string) {
                const modelConfig = QWEN_MODELS[modelID as keyof typeof QWEN_MODELS]
                return sdk.languageModel(modelConfig?.id ?? modelID)
            },
            options: {
                apiKey: "no-key",
                baseURL: QWEN_API_URL,
                fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                    const { getAccessCredentials } = await import("../qwen-cli")
                    const creds = await getAccessCredentials()
                    if (!creds) throw new Error("Unauthorized")

                    const headers = new Headers(init?.headers)
                    headers.set("Authorization", `Bearer ${creds.token}`)

                    const rawURL = typeof input === "string" ? input : input.toString()
                    const requestURL = rawURL.startsWith(QWEN_API_URL)
                        ? rawURL.replace(QWEN_API_URL, creds.baseURL)
                        : rawURL

                    let response = await fetch(requestURL, { ...init, headers })
                    if (response.status === 401) {
                        const refreshed = await getAccessCredentials(true)
                        if (refreshed) {
                            headers.set("Authorization", `Bearer ${refreshed.token}`)
                            const retryURL = requestURL.startsWith(creds.baseURL)
                                ? requestURL.replace(creds.baseURL, refreshed.baseURL)
                                : requestURL
                            response = await fetch(retryURL, { ...init, headers })
                        }
                    }
                    return response
                },
            },
        }
    },
}
