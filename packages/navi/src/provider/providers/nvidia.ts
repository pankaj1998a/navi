import type { ProviderLoader } from "../loader"

const PROVIDER_ID = "nvidia"
const BASE_URL = "https://integrate.api.nvidia.com/v1"

export const NvidiaProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const apiKey = (() => {
            const envKey = (input?.env ?? ["NVIDIA_API_KEY"]).map((k) => dep.env[k]).find(Boolean)
            if (envKey) return envKey
            return undefined
        })()

        const auth = await dep.auth(PROVIDER_ID)
        const resolved =
            apiKey ??
            (auth?.type === "api" ? auth.key : undefined) ??
            dep.config.provider?.[PROVIDER_ID]?.options?.apiKey

        const hasKey = !!resolved
        const baseURL = input?.options?.baseURL ?? dep.config.provider?.[PROVIDER_ID]?.options?.baseURL
        if (typeof baseURL === "string" && baseURL !== BASE_URL) {
            return { autoload: hasKey, options: {}, models: hasKey ? undefined : {} }
        }

        return {
            autoload: hasKey,
            options: {
                headers: {
                    "HTTP-Referer": "https://navi.ai/",
                    "X-Title": "navi",
                    "X-BILLING-INVOKE-ORIGIN": "Navi",
                },
            },
            models: hasKey ? undefined : {},
        }
    },
}
