import { ProviderLoader } from "../loader"

export const GitHubCopilotProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            async getModel(sdk: any, modelID: string) {
                if (modelID.includes("codex")) {
                    return sdk.responses(modelID)
                }
                return sdk.chat(modelID)
            },
            options: {},
        }
    },
}

export const GitHubCopilotEnterpriseProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            async getModel(sdk: any, modelID: string) {
                if (modelID.includes("codex")) {
                    return sdk.responses(modelID)
                }
                return sdk.chat(modelID)
            },
            options: {},
        }
    },
}


