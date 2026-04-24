import { ProviderLoader } from "../loader"
import { Auth } from "../../auth"
import { Config } from "../../config/config"
import { Env } from "../../env"
import { iife } from "../../util/iife"

export const SapAiCoreProvider: ProviderLoader.Info = {
  async load() {
    const auth = await Auth.get("sap-ai-core")
    const envServiceKey = iife(() => {
      const envAICoreServiceKey = Env.get("AICORE_SERVICE_KEY")
      if (envAICoreServiceKey) return envAICoreServiceKey
      if (auth?.type === "api") {
        Env.set("AICORE_SERVICE_KEY", auth.key)
        return auth.key
      }
      return undefined
    })
    const deploymentId = Env.get("AICORE_DEPLOYMENT_ID")
    const resourceGroup = Env.get("AICORE_RESOURCE_GROUP")

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
  async load(input) {
    if (!input) return { autoload: false, options: {} }
    const hasKey = await (async () => {
      const env = Env.all()
      if (input.env.some((item) => env[item])) return true
      if (await Auth.get(input.id)) return true
      const config = await Config.get()
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
  async load() {
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


