import type { ProviderLoader } from "../loader"

const PROVIDER_ID = "modal"

export const ModalProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const auth = await dep.auth(PROVIDER_ID)
        const apiKey =
            (auth?.type === "api" ? auth.key : undefined) ??
            dep.env["MODAL_PROXY_TOKEN"] ??
            dep.config.provider?.[PROVIDER_ID]?.options?.apiKey
        const baseURL = input?.options?.baseURL ?? dep.config.provider?.[PROVIDER_ID]?.options?.baseURL

        const hasKey = !!apiKey && typeof baseURL === "string" && baseURL.length > 0
        return {
            autoload: hasKey,
            options: hasKey ? { apiKey, baseURL } : {},
            models: hasKey ? undefined : {},
        }
    },
}
