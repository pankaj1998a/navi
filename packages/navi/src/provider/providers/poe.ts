import type { ProviderLoader } from "../loader"

const PROVIDER_ID = "poe"

export const PoeProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const apiKey = (() => {
            const envKey = (input?.env ?? ["POE_API_KEY"]).map((k) => dep.env[k]).find(Boolean)
            if (envKey) return envKey
            return undefined
        })()

        const auth = await dep.auth(PROVIDER_ID)
        const resolved =
            apiKey ??
            (auth?.type === "oauth" ? auth.access : auth?.type === "api" ? auth.key : undefined) ??
            dep.config.provider?.[PROVIDER_ID]?.options?.apiKey

        const hasKey = !!resolved
        return {
            autoload: hasKey,
            options: {},
            models: hasKey ? undefined : {},
        }
    },
}
