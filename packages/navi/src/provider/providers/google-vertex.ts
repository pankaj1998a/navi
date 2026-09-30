import type { ProviderLoader } from "../loader"
import { Env } from "../../env"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "provider-google" })

export const GoogleVertexProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const env = dep.env
        const project = env["GOOGLE_CLOUD_PROJECT"] ?? env["GCP_PROJECT"] ?? env["GCLOUD_PROJECT"]
        const location = env["GOOGLE_CLOUD_LOCATION"] ?? env["VERTEX_LOCATION"] ?? "us-east5"
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
    async load(input, dep) {
        const env = dep.env
        const project = env["GOOGLE_CLOUD_PROJECT"] ?? env["GCP_PROJECT"] ?? env["GCLOUD_PROJECT"]
        const location = env["GOOGLE_CLOUD_LOCATION"] ?? env["VERTEX_LOCATION"] ?? "global"
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


