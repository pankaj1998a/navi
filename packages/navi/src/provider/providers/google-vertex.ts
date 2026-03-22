import { ProviderLoader } from "../loader"
import { Env } from "../../env"
import { Log } from "../../util/log"

const log = Log.create({ service: "provider-google" })

export const GoogleVertexProvider: ProviderLoader.Info = {
    async load() {
        const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
        const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-east5"
        if (!project) return { autoload: false }
        return {
            autoload: true,
            options: { project, location },
            async getModel(sdk: any, modelID: string) {
                return sdk.languageModel(String(modelID).trim())
            },
        }
    },
}

export const GoogleVertexAnthropicProvider: ProviderLoader.Info = {
    async load() {
        const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
        const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
        if (!project) return { autoload: false }
        return {
            autoload: true,
            options: { project, location },
            async getModel(sdk: any, modelID) {
                return sdk.languageModel(String(modelID).trim())
            },
        }
    },
}
