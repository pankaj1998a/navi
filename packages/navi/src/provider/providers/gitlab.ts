import os from "os"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Env } from "../../env"
import { Installation } from "../../installation"
import { ProviderLoader } from "../loader"

export const GitLabProvider: ProviderLoader.Info = {
    async load(input) {
        const instanceUrl = Env.get("GITLAB_INSTANCE_URL") || "https://gitlab.com"

        const auth = await Auth.get(input.id)
        const apiKey = await (async () => {
            if (auth?.type === "oauth") return auth.access
            if (auth?.type === "api") return auth.key
            return Env.get("GITLAB_TOKEN")
        })()

        const config = await Config.get()
        const providerConfig = config.provider?.["gitlab"]

        // version 0.1.x of navi matches opencode current logic
        const aiGatewayHeaders = {
            "User-Agent": `navi/${Installation.VERSION} gitlab-ai-provider (unknown) (${os.platform()} ${os.release()}; ${os.arch()})`,
            ...(providerConfig?.options?.aiGatewayHeaders || {}),
        }

        return {
            autoload: !!apiKey,
            options: {
                instanceUrl,
                apiKey,
                aiGatewayHeaders,
                featureFlags: {
                    duo_agent_platform_agentic_chat: true,
                    duo_agent_platform: true,
                    ...(providerConfig?.options?.featureFlags || {}),
                },
            },
            async getModel(sdk: any, modelID: string) {
                return sdk.agenticChat(modelID, {
                    aiGatewayHeaders,
                    featureFlags: {
                        duo_agent_platform_agentic_chat: true,
                        duo_agent_platform: true,
                        ...(providerConfig?.options?.featureFlags || {}),
                    },
                })
            },
        }
    },
}
