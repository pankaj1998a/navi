import { ProviderLoader } from "../loader"
import { Env } from "../../env"
import { Auth } from "../../auth"
import { iife } from "../../util/iife"

export const CloudflareAiGatewayProvider: ProviderLoader.Info = {
    async load(input) {
        const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
        const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

        if (!accountId || !gateway) return { autoload: false }

        const apiToken = await (async () => {
            const envToken = Env.get("CLOUDFLARE_API_TOKEN")
            if (envToken) return envToken
            const auth = await Auth.get(input.id)
            if (auth?.type === "api") return auth.key
            return undefined
        })()

        return {
            autoload: true,
            async getModel(sdk: any, modelID: string) {
                return sdk.languageModel(modelID)
            },
            options: {
                baseURL: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gateway}/compat`,
                headers: {
                    ...(apiToken ? { "cf-aig-authorization": `Bearer ${apiToken}` } : {}),
                    "HTTP-Referer": "https://navi.ai/",
                    "X-Title": "navi",
                },
                fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                    const headers = new Headers(init?.headers)
                    headers.delete("Authorization")

                    if (init?.body && init.method === "POST") {
                        try {
                            const body = JSON.parse(init.body as string)
                            if (body.max_tokens !== undefined && !body.max_completion_tokens) {
                                body.max_completion_tokens = body.max_tokens
                                delete body.max_tokens
                                init = { ...init, body: JSON.stringify(body) }
                            }
                        } catch (e) {
                            console.error("[Cloudflare] Failed to parse request body for max_completion_tokens fix", e)
                        }
                    }

                    return fetch(input, { ...init, headers })
                },
            },
        }
    },
}
