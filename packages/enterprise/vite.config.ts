import { defineConfig, PluginOption } from "vite"
// @ts-ignore
import solid from "vite-plugin-solid"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"

const nitroConfig: any = (() => {
  const target = process.env.navi_DEPLOYMENT_TARGET
  if (target === "cloudflare") {
    return {
      compatibilityDate: "2024-09-19",
      preset: "cloudflare_module",
      cloudflare: {
        nodeCompat: true,
      },
    }
  }
  return {}
})()

export default defineConfig({
  plugins: [
    tailwindcss(),
    solid() as PluginOption,
    nitro({
      ...nitroConfig,
      baseURL: process.env.navi_BASE_URL,
    }),
  ],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  worker: {
    format: "es",
  },
})
