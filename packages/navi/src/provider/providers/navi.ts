import type { ProviderLoader } from "../loader"
import { Env } from "../../env"
import { Auth } from "../../auth"
import { Config } from "../../config/config"

export const NaviProvider: ProviderLoader.Info = {
  async load(input, dep) {
    if (!input) return { autoload: false, options: {} }
    const hasKey = await (async () => {
      const env = dep.env
      if (input.env.some((item) => env[item])) return true
      if (await dep.auth(input.id)) return true
      const config = dep.config
      if (config.provider?.["navi"]?.options?.apiKey) return true
      return false
    })()

    const models = { ...input.models }

    if (!hasKey) {
      for (const [key, value] of Object.entries(models)) {
        if (value.cost.input === 0) continue
        delete models[key]
      }
    }

    return {
      autoload: Object.keys(models).length > 0,
      options: {
        ...(hasKey ? {} : { apiKey: "public" }),
        headers: {
          "HTTP-Referer": "https://Navi.ai/",
          "X-Title": "Navi",
        },
      },
      models,
    }
  },
}


