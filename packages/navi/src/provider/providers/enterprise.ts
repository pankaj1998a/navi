import type { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Env } from "../../env"
import { iife } from "../../util/iife"

export const SapAiCoreProvider: ProviderLoader.Info = {
  async load(input, dep) {
    const auth = await dep.auth("sap-ai-core")
    const envAICoreServiceKey = dep.env["AICORE_SERVICE_KEY"]
    const envServiceKey = envAICoreServiceKey ?? (auth?.type === "api" ? auth.key : undefined)
    const deploymentId = dep.env["AICORE_DEPLOYMENT_ID"]
    const resourceGroup = dep.env["AICORE_RESOURCE_GROUP"]

    return {
      autoload: !!envServiceKey,
      options: envServiceKey ? { deploymentId, resourceGroup } : {},
      async getModel(sdk: any, modelID: string) {
        return sdk(modelID)
      },
    }
  },
}

export const ZenmuxProvider: ProviderLoader.Info = {
  async load(input, dep) {
    if (!input) return { autoload: false, options: {} }
    const hasKey = await (async () => {
      const env = dep.env
      if (input.env.some((item) => env[item])) return true
      if (await dep.auth(input.id)) return true
      const config = dep.config
      if (config.provider?.["zenmux"]?.options?.apiKey) return true
      return false
    })()

    const models = { ...input.models }

    if (!hasKey) {
      // Public access is no longer available for ZenMux, clear models if no key found
      for (const key of Object.keys(models)) {
        delete models[key]
      }
    }

    return {
      autoload: Object.keys(models).length > 0,
      options: {
        // Use Navi headers to avoid rate limiting
        headers: {
          "HTTP-Referer": "https://Navi.ai/",
          "X-Title": "Navi",
        },
      },
      models,
    }
  },
}

export const CerebrasProvider: ProviderLoader.Info = {
  async load(input, dep) {
    return {
      autoload: false,
      options: {
        headers: {
          "X-Cerebras-3rd-Party-Integration": "navi",
        },
      },
    }
  },
}


