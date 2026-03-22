import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { ANTIGRAVITY_MODELS } from "./antigravity"
import { GEMINI_MODELS, GEMINI_API_URL } from "./gemini-cli"
import { QWEN_MODELS, QWEN_API_URL } from "./qwen-cli"
import z from "zod"
import * as ModelsMacro from "./models-macro"
// @ts-ignore
import { data as macroData } from "./models-macro" with { type: "macro" }
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { mergeDeep } from "remeda"
import { fileURLToPath } from "url"
import fs from "fs/promises"
import { ProviderDiagnostics } from "./diagnostics"

const MODELS_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = () => path.join(Global.Path.cache, "models.json")

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string() }).optional(),
    isFree: z.boolean().optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    catalog: z
      .object({
        providerID: z.string(),
        source: z.enum(["embedded", "cache", "fetch", "stale-cache"]),
        fetchedAt: z.string(),
        ageMs: z.number().optional(),
      })
      .optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
    catalog: z
      .object({
        source: z.enum(["embedded", "cache"]),
        fetchedAt: z.string(),
        ageMs: z.number().optional(),
      })
      .optional(),
  })

  export type Provider = z.infer<typeof Provider>

  export async function get() {
    await refresh()
    const file = Bun.file(filepath())
    const result = (await file.json().catch(() => { })) as Record<string, Provider> | undefined
    const catalogFileStat = await fs.stat(filepath()).catch(() => undefined)
    const catalogFetchedAt = catalogFileStat ? catalogFileStat.mtime.toISOString() : new Date().toISOString()
    const catalogAgeMs = catalogFileStat ? Date.now() - catalogFileStat.mtime.getTime() : undefined
    let modelsData: string
    try {
      // @ts-ignore - macroData might not be defined if macro expansion fails
      const d = macroData
      modelsData = await (typeof d === "function" ? d() : d)
    } catch {
      modelsData = await ModelsMacro.data()
    }
    const providers = result || (JSON.parse(modelsData) as Record<string, Provider>)

    for (const provider of Object.values(providers)) {
      provider.catalog = {
        source: result ? "cache" : "embedded",
        fetchedAt: catalogFetchedAt,
        ageMs: catalogAgeMs,
      }
      for (const model of Object.values(provider.models)) {
        model.catalog = {
          providerID: provider.id,
          source: result ? "cache" : "embedded",
          fetchedAt: catalogFetchedAt,
          ageMs: catalogAgeMs,
        }
      }
    }

    // Inject local free models if present
    try {
      const freeModelsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "free-models.json")
      const freeModelsFile = Bun.file(freeModelsPath)
      if (await freeModelsFile.exists()) {
        const freeModels = await freeModelsFile.json()
        for (const [id, provider] of Object.entries(freeModels)) {
          providers[id] = mergeDeep(providers[id] ?? {}, provider as any)
        }
      }
    } catch (e) {
      log.error("Failed to load free-models.json", { error: e })
    }

    // Inject Antigravity provider
    const antigravityModels: Record<string, Model> = {}
    for (const [id, config] of Object.entries(ANTIGRAVITY_MODELS)) {
      antigravityModels[id] = {
        id: config.id,
        name: config.name,
        release_date: new Date().toISOString(),
        attachment: (config as any).attachment ?? false,
        reasoning: (config as any).thinking ?? false,
        temperature: true,
        tool_call: true,
        limit: config.limit,
        modalities: config.modalities as any,
        options: (config as any).options ?? {},
        variants: (config as any).variants as any,
      }
    }
    providers["google-antigravity"] = {
      id: "google-antigravity",
      name: "Antigravity (Google OAuth)",
      api: GEMINI_API_URL,   // @ai-sdk/google uses generativelanguage.googleapis.com; antigravityFetch intercepts to cloudcode-pa
      npm: "@ai-sdk/google",
      env: [],
      catalog: {
        source: result ? "cache" : "embedded",
        fetchedAt: catalogFetchedAt,
        ageMs: catalogAgeMs,
      },
      models: antigravityModels,
    }

    // Inject Gemini CLI provider
    const geminiCLIModels: Record<string, Model> = {}
    for (const [id, config] of Object.entries(GEMINI_MODELS)) {
      const typedConfig = config as any
      geminiCLIModels[id] = {
        id: typedConfig.id,
        name: typedConfig.name,
        release_date: new Date().toISOString(),
        attachment: false,
        reasoning: typedConfig.thinking ?? false,
        temperature: true,
        tool_call: true,
        limit: typedConfig.limit,
        options: typedConfig.options ?? {},
        variants: typedConfig.variants as any,
      }
    }
    providers["gemini-cli"] = {
      id: "gemini-cli",
      name: "Gemini CLI",
      api: GEMINI_API_URL,
      npm: "@ai-sdk/google",
      env: [],
      catalog: {
        source: result ? "cache" : "embedded",
        fetchedAt: catalogFetchedAt,
        ageMs: catalogAgeMs,
      },
      models: geminiCLIModels,
    }

    // Inject Qwen CLI provider
    const qwenCLIModels: Record<string, Model> = {}
    for (const [id, config] of Object.entries(QWEN_MODELS)) {
      const typedConfig = config as any
      qwenCLIModels[id] = {
        id: typedConfig.id,
        name: typedConfig.name,
        release_date: new Date().toISOString(),
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: typedConfig.limit,
        options: typedConfig.options ?? {},
        variants: typedConfig.variants as any,
      }
    }
    providers["qwen-cli"] = {
      id: "qwen-cli",
      name: "Qwen CLI",
      api: QWEN_API_URL,
      npm: "@ai-sdk/openai-compatible",
      env: [],
      catalog: {
        source: result ? "cache" : "embedded",
        fetchedAt: catalogFetchedAt,
        ageMs: catalogAgeMs,
      },
      models: qwenCLIModels,
    }

    providers["cline"] = {
      id: "cline",
      name: "Cline",
      api: "https://api.cline.bot/api/v1",
      npm: "@ai-sdk/openai-compatible",
      env: [],
      catalog: {
        source: result ? "cache" : "embedded",
        fetchedAt: catalogFetchedAt,
        ageMs: catalogAgeMs,
      },
      models: {},
    }

    providers["roocode"] = {
      id: "roocode",
      name: "Roo Code",
      api: "https://api.roocode.com/proxy/v1",
      npm: "@ai-sdk/openai-compatible",
      env: [],
      catalog: {
        source: result ? "cache" : "embedded",
        fetchedAt: catalogFetchedAt,
        ageMs: catalogAgeMs,
      },
      models: {},
    }


    // Alias opencode to navi if present
    if (providers["opencode"]) {
      providers["navi"] = {
        ...providers["opencode"],
        id: "navi",
        name: "Navi",
        models: { ...providers["opencode"].models },
      }
    }

    // Alias kilo to kilocode
    if (providers["kilo"]) {
      const existingModels = providers["kilocode"]?.models ?? {}
      providers["kilocode"] = {
        ...providers["kilo"],
        id: "kilocode",
        name: "Kilo Code",
        models: { ...providers["kilo"].models, ...existingModels },
      }
    }

    for (const provider of Object.values(providers)) {
      provider.catalog = {
        source: result ? "cache" : "embedded",
        fetchedAt: catalogFetchedAt,
        ageMs: catalogAgeMs,
      }
      for (const model of Object.values(provider.models)) {
        model.catalog = {
          providerID: provider.id,
          source: result ? "cache" : "embedded",
          fetchedAt: catalogFetchedAt,
          ageMs: catalogAgeMs,
        }
      }
    }

    return providers
  }


  export async function refresh(force = false) {
    if (Flag.NAVI_DISABLE_MODELS_FETCH) {
      await ProviderDiagnostics.record({
        scope: "models-dev",
        status: "skipped",
        refreshedAt: Date.now(),
        durationMs: 0,
        reason: "models fetch disabled",
        source: "embedded",
      })
      return
    }
    const file = Bun.file(filepath())
    const startedAt = Date.now()

    try {
      const stat = await fs.stat(filepath())
      const ageMs = Date.now() - stat.mtimeMs
      if (!force && ageMs < MODELS_REFRESH_INTERVAL_MS) {
        log.info("refresh skipped; cache still fresh", { ageMs })
        await ProviderDiagnostics.record({
          scope: "models-dev",
          status: "skipped",
          refreshedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          reason: `cache still fresh (${ageMs}ms)`,
          source: "cache",
        })
        return
      }
    } catch {
      // Cache missing or unreadable; fall through to fetch.
    }

    log.info("refreshing", {
      file,
    })
    const result = await fetch("https://models.dev/api.json", {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
      return undefined
    })
    if (result && result.ok) {
      const text = await result.text()
      await Bun.write(file, text)
      let modelCount: number | undefined
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        modelCount = Object.keys(parsed).length
      } catch {
        modelCount = undefined
      }
      await ProviderDiagnostics.record({
        scope: "models-dev",
        status: "success",
        refreshedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        modelCount,
        source: "fetch",
      })
      return
    }
    await ProviderDiagnostics.record({
      scope: "models-dev",
      status: "failure",
      refreshedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      error: result ? `HTTP ${result.status}` : "fetch failed",
      source: "fetch",
    })
  }
}


setInterval(() => ModelsDev.refresh(), MODELS_REFRESH_INTERVAL_MS).unref()
