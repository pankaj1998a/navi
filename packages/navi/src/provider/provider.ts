import z from "zod"
import os from "os"
import fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import freeModels from "./free-models.json"
import { NoSuchModelError, type Provider as SDK } from "ai"
import * as Log from "@navi-ai/core/util/log"
import { Hash } from "@navi-ai/core/util/hash"
import { Plugin } from "../plugin"
import { NamedError } from "@navi-ai/core/util/error"
import { type LanguageModelV3 } from "@ai-sdk/provider"
import { ModelsDev } from "./models"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance } from "../project/instance"
import { Flag } from "@navi-ai/core/flag/flag"
import { iife } from "../util/iife"
import { Global } from "@navi-ai/core/global"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { Effect, Layer, Context, Schema, Runtime } from "effect"
import { InstanceState } from "@/effect/instance-state"

import { fileURLToPath } from "url"
import { AppFileSystem } from "@navi-ai/core/filesystem"

// Direct imports for bundled providers
import { createAmazonBedrock, type AmazonBedrockProviderSettings } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createVertex } from "@ai-sdk/google-vertex"
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createOpenaiCompatible as createGitHubCopilotOpenAICompatible } from "./sdk/copilot"
import { createXai } from "@ai-sdk/xai"
import { createMistral } from "@ai-sdk/mistral"
import { createGroq } from "@ai-sdk/groq"
import { createDeepInfra } from "@ai-sdk/deepinfra"
import { createCerebras } from "@ai-sdk/cerebras"
import { createCohere } from "@ai-sdk/cohere"
import { createGateway } from "@ai-sdk/gateway"
import { createTogetherAI } from "@ai-sdk/togetherai"
import { createPerplexity } from "@ai-sdk/perplexity"
import { createVercel } from "@ai-sdk/vercel"
import {
  createGitLab,
  VERSION as GITLAB_PROVIDER_VERSION,
  isWorkflowModel,
  discoverWorkflowModels,
} from "gitlab-ai-provider"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { GoogleAuth } from "google-auth-library"
import { ProviderTransform } from "./transform"
import { Installation } from "../installation"
import { ModelID, ProviderID } from "./schema"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  function shouldUseCopilotResponsesApi(modelID: string): boolean {
    const match = /^gpt-(\d+)/.exec(modelID)
    if (!match) return false
    return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
  }

  function wrapSSE(res: Response, ms: number, ctl: AbortController) {
    if (typeof ms !== "number" || ms <= 0) return res
    if (!res.body) return res
    if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

    const reader = res.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
          const id = setTimeout(() => {
            const err = new Error("SSE read timed out")
            ctl.abort(err)
            void reader.cancel(err)
            reject(err)
          }, ms)

          reader.read().then(
            (part) => {
              clearTimeout(id)
              resolve(part)
            },
            (err) => {
              clearTimeout(id)
              reject(err)
            },
          )
        })

        if (part.done) {
          ctrl.close()
          return
        }

        ctrl.enqueue(part.value)
      },
      async cancel(reason) {
        ctl.abort(reason)
        await reader.cancel(reason)
      },
    })

    return new Response(body, {
      headers: new Headers(res.headers),
      status: res.status,
      statusText: res.statusText,
    })
  }

  type BundledSDK = {
    languageModel(modelId: string): LanguageModelV3
  }

  const BUNDLED_PROVIDERS: Record<string, (options: any) => BundledSDK> = {
    "@ai-sdk/amazon-bedrock": createAmazonBedrock,
    "@ai-sdk/anthropic": createAnthropic,
    "@ai-sdk/azure": createAzure,
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/google-vertex": createVertex,
    "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
    "@ai-sdk/openai": createOpenAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    "@openrouter/ai-sdk-provider": createOpenRouter,
    "@ai-sdk/xai": createXai,
    "@ai-sdk/mistral": createMistral,
    "@ai-sdk/groq": createGroq,
    "@ai-sdk/deepinfra": createDeepInfra,
    "@ai-sdk/cerebras": createCerebras,
    "@ai-sdk/cohere": createCohere,
    "@ai-sdk/gateway": createGateway,
    "@ai-sdk/togetherai": createTogetherAI,
    "@ai-sdk/perplexity": createPerplexity,
    "@ai-sdk/vercel": createVercel,
    "gitlab-ai-provider": createGitLab,
    "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible,
  }

  type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
  type CustomVarsLoader = (options: Record<string, any>) => Record<string, string>
  type CustomDiscoverModels = () => Promise<Record<string, Model>>
  type CustomLoader = (provider: Info) => Promise<{
    autoload: boolean
    getModel?: CustomModelLoader
    vars?: CustomVarsLoader
    options?: Record<string, any>
    discoverModels?: CustomDiscoverModels
    models?: Record<string, Model>
  }>

  function useLanguageModel(sdk: any) {
    return sdk.responses === undefined && sdk.chat === undefined
  }

  function custom(dep: {
    auth: (id: string) => Promise<Auth.Info | undefined>
    config: Config.Info
    env: Record<string, string | undefined>
  }): Record<string, CustomLoader> {
    return {
    async navi(input) {
      const hasKey = await (async () => {
        const allEnv = dep.env
        if (input.env.some((item) => allEnv[item])) return true
        if (await dep.auth("navi")) return true
        const config = dep.config
        if (config.provider?.["navi"]?.options?.apiKey) return true
        return false
      })()

      if (!hasKey) {
        for (const [key, value] of Object.entries(input.models)) {
          if (value.cost.input === 0) continue
          delete input.models[key]
        }
      }

      return {
        autoload: Object.keys(input.models).length > 0,
        options: hasKey ? {} : { apiKey: "public" },
      }
    },
    openai: async (input) => {
      const { OpenAIProvider } = await import("./providers/openai")
      return OpenAIProvider.load(input, dep)
    },
    xai: async (input) => {
      const { XaiProvider } = await import("./providers/xai")
      return XaiProvider.load(input, dep)
    },
    "github-copilot": async (input) => {
      const { GitHubCopilotProvider } = await import("./providers/github-copilot")
      return GitHubCopilotProvider.load(input, dep)
    },
    azure: async (input) => {
      const { AzureProvider } = await import("./providers/azure")
      return AzureProvider.load(input, dep)
    },
    "azure-cognitive-services": async (input) => {
      const { AzureCognitiveServicesProvider } = await import("./providers/azure")
      return AzureCognitiveServicesProvider.load(input, dep)
    },
    "amazon-bedrock": async (input) => {
      const { AmazonBedrockProvider } = await import("./providers/amazon-bedrock")
      return AmazonBedrockProvider.load(input, dep)
    },
    openrouter: async (input) => {
      const { OpenrouterProvider } = await import("./providers/misc")
      return OpenrouterProvider.load(input, dep)
    },
    vercel: async (input) => {
      const { VercelProvider } = await import("./providers/misc")
      return VercelProvider.load(input, dep)
    },
    "google-vertex": async (input) => {
      const { GoogleVertexProvider } = await import("./providers/google-vertex")
      return GoogleVertexProvider.load(input, dep)
    },
    "google-vertex-anthropic": async (input) => {
      const { GoogleVertexAnthropicProvider } = await import("./providers/google-vertex")
      return GoogleVertexAnthropicProvider.load(input, dep)
    },
    anthropic: async (input) => {
      const { AnthropicProvider } = await import("./providers/anthropic")
      return AnthropicProvider.load(input, dep)
    },
    mistral: async (input) => {
      const { MistralProvider } = await import("./providers/mistral")
      return MistralProvider.load(input, dep)
    },
    deepseek: async (input) => {
      const { DeepSeekProvider } = await import("./providers/deepseek")
      return DeepSeekProvider.load(input, dep)
    },
    togetherai: async (input) => {
      const { TogetherAIProvider } = await import("./providers/togetherai")
      return TogetherAIProvider.load(input, dep)
    },
    groq: async (input) => {
      const { GroqProvider } = await import("./providers/groq")
      return GroqProvider.load(input, dep)
    },
    cohere: async (input) => {
      const { CohereProvider } = await import("./providers/cohere")
      return CohereProvider.load(input, dep)
    },
    perplexity: async (input) => {
      const { PerplexityProvider } = await import("./providers/perplexity")
      return PerplexityProvider.load(input, dep)
    },
    deepinfra: async (input) => {
      const { DeepInfraProvider } = await import("./providers/deepinfra")
      return DeepInfraProvider.load(input, dep)
    },
    "sap-ai-core": async (input) => {
      const { SapAiCoreProvider } = await import("./providers/enterprise")
      return SapAiCoreProvider.load(input, dep)
    },
    zenmux: async (input) => {
      const { ZenmuxProvider } = await import("./providers/enterprise")
      return ZenmuxProvider.load(input, dep)
    },
    gitlab: async (input) => {
      const { GitLabProvider } = await import("./providers/gitlab")
      return GitLabProvider.load(input, dep)
    },
    "cloudflare-workers-ai": async (input) => {
      const accountId = dep.env["CLOUDFLARE_ACCOUNT_ID"]
      if (!accountId) return { autoload: false }

      const apiKey = await iife(async () => {
        const envToken = dep.env["CLOUDFLARE_API_KEY"]
        if (envToken) return envToken
        const auth = await dep.auth(input.id)
        if (auth?.type === "api") return auth.key
        return undefined
      })

      return {
        autoload: !!apiKey,
        options: {
          apiKey,
        },
        async getModel(sdk: any, modelID: string) {
          return sdk.languageModel(modelID)
        },
        vars(_options) {
          return {
            CLOUDFLARE_ACCOUNT_ID: accountId,
          }
        },
      }
    },
    "cloudflare-ai-gateway": async (input) => {
      const accountId = dep.env["CLOUDFLARE_ACCOUNT_ID"]
      const gateway = dep.env["CLOUDFLARE_GATEWAY_ID"]

      if (!accountId || !gateway) return { autoload: false }

      const apiKey = await iife(async () => {
        const envToken = dep.env["CLOUDFLARE_API_TOKEN"] || dep.env["CF_AIG_TOKEN"]
        if (envToken) return envToken
        const auth = await dep.auth(input.id)
        if (auth?.type === "api") return auth.key
        return undefined
      })

      if (!apiKey) {
        throw new Error(
          "CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. " +
            "Set it via environment variable or run `Navi auth cloudflare-ai-gateway`.",
        )
      }

      // Use official ai-gateway-provider package (v2.x for AI SDK v5 compatibility)
      const { createAiGateway } = await import("ai-gateway-provider")
      const { createUnified } = await import("ai-gateway-provider/providers/unified")

      const metadata = iife(() => {
        if (input.options?.metadata) return input.options.metadata
        try {
          return JSON.parse(input.options?.headers?.["cf-aig-metadata"])
        } catch {
          return undefined
        }
      })
      const opts = {
        metadata,
        cacheTtl: input.options?.cacheTtl,
        cacheKey: input.options?.cacheKey,
        skipCache: input.options?.skipCache,
        collectLog: input.options?.collectLog,
      }

      const aigateway = createAiGateway({
        accountId,
        gateway,
        apiKey,
        ...(Object.values(opts).some((v) => v !== undefined) ? { options: opts } : {}),
      })
      const unified = createUnified()

      return {
        autoload: true,
        async getModel(_sdk: any, modelID: string, _options?: Record<string, any>) {
          // Model IDs use Unified API format: provider/model (e.g., "anthropic/claude-sonnet-4-5")
          return aigateway(unified(modelID))
        },
        options: {},
      }
    },
    cerebras: async () => {
      return {
        autoload: false,
        options: {
          headers: {
            "X-Cerebras-3rd-Party-Integration": "Navi",
          },
        },
      }
    },
    kilocode: async (input) => {
      const { KilocodeProvider } = await import("./providers/kilocode")
      return KilocodeProvider.load(input, dep)
    },
  }
}

  export const Model = z
    .object({
      id: ModelID.zod,
      providerID: ProviderID.zod,
      api: z.object({
        id: z.string(),
        url: z.string(),
        npm: z.string(),
      }),
      name: z.string(),
      family: z.string().optional(),
      capabilities: z.object({
        temperature: z.boolean(),
        reasoning: z.boolean(),
        attachment: z.boolean(),
        toolcall: z.boolean(),
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        interleaved: z.union([
          z.boolean(),
          z.object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          }),
        ]),
      }),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        reasoning: z.number().optional(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            reasoning: z.number().optional(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        input: z.number().optional(),
        output: z.number(),
      }),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()),
      release_date: z.string(),
      variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
      isFree: z.boolean().optional(),
      catalog: z
        .object({
          providerID: z.string(),
          source: z.enum(["embedded", "cache", "fetch", "stale-cache"]),
          fetchedAt: z.string(),
          ageMs: z.number().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: ProviderID.zod,
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.string().array(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  export interface Interface {
    readonly list: () => Effect.Effect<Record<ProviderID, Info>>
    readonly getProvider: (providerID: ProviderID) => Effect.Effect<Info>
    readonly getModel: (providerID: ProviderID, modelID: ModelID) => Effect.Effect<Model>
    readonly getLanguage: (model: Model) => Effect.Effect<LanguageModelV3>
    readonly closest: (
      providerID: ProviderID,
      query: string[],
    ) => Effect.Effect<{ providerID: ProviderID; modelID: string } | undefined>
    readonly getSmallModel: (providerID: ProviderID) => Effect.Effect<Model | undefined>
    readonly database: () => Effect.Effect<Record<string, Info>>
    readonly defaultModel: () => Effect.Effect<{ providerID: ProviderID; modelID: ModelID }>
  }

  interface State {
    models: Map<string, LanguageModelV3>
    providers: Record<ProviderID, Info>
    sdk: Map<string, BundledSDK>
    modelLoaders: Record<string, CustomModelLoader>
    varsLoaders: Record<string, CustomVarsLoader>
    database: Record<string, Info>
  }

  export class Service extends Context.Service<Service, Interface>()("@navi/Provider") {}

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
      id: ModelID.make(model.id),
      providerID: ProviderID.make(provider.id),
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: model.provider?.api ?? provider.api ?? "",
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: (model as any).headers ?? {},
      options: (model as any).options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        reasoning: (model.cost as any)?.reasoning,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
        experimentalOver200K: model.cost?.context_over_200k
          ? {
              cache: {
                read: model.cost.context_over_200k.cache_read ?? 0,
                write: model.cost.context_over_200k.cache_write ?? 0,
              },
              input: model.cost.context_over_200k.input,
              output: model.cost.context_over_200k.output,
              reasoning: (model.cost.context_over_200k as any).reasoning,
            }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        input: model.limit.input,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature ?? false,
        reasoning: model.reasoning ?? false,
        attachment: model.attachment ?? false,
        toolcall: model.tool_call ?? true,
        input: {
          text: model.modalities?.input?.includes("text") ?? false,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? false,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
        interleaved: model.interleaved ?? false,
      },
      release_date: model.release_date ?? "",
      variants: {},
    }

    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
  }

  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    const models: Record<string, Model> = {}
    for (const [modelID, model] of Object.entries(provider.models)) {
      const baseModel = fromModelsDevModel(provider, model)
      models[modelID] = baseModel

      if (model.experimental?.modes) {
        for (const [modeName, modeConfig] of Object.entries(model.experimental.modes)) {
          const modeModelID = `${modelID}-${modeName}`

          let experimentalOver200K = undefined
          if (modeConfig.cost?.context_over_200k) {
            experimentalOver200K = {
              input: modeConfig.cost.context_over_200k.input,
              output: modeConfig.cost.context_over_200k.output,
              cache: {
                read: modeConfig.cost.context_over_200k.cache_read ?? 0,
                write: modeConfig.cost.context_over_200k.cache_write ?? 0,
              }
            }
          } else if (baseModel.cost.experimentalOver200K) {
            experimentalOver200K = baseModel.cost.experimentalOver200K
          }

          const modeModel: Model = {
            ...baseModel,
            id: ModelID.make(modeModelID),
            cost: {
              ...baseModel.cost,
              input: modeConfig.cost?.input ?? baseModel.cost.input,
              output: modeConfig.cost?.output ?? baseModel.cost.output,
              cache: {
                read: modeConfig.cost?.cache_read ?? baseModel.cost.cache.read,
                write: modeConfig.cost?.cache_write ?? baseModel.cost.cache.write,
              },
              experimentalOver200K,
            },
            options: {
              ...baseModel.options,
              ...(modeConfig.provider?.body ? { serviceTier: modeConfig.provider.body.service_tier } : {}),
            }
          }
          models[modeModelID] = modeModel
        }
      }
    }

    return {
      id: ProviderID.make(provider.id),
      source: "custom",
      name: provider.name,
      env: [...(provider.env ?? [])],
      options: {},
      models,
    }
  }

  const layer: Layer.Layer<Service, never, Config.Service | Auth.Service | Env.Service | Plugin.Service | ModelsDev.Service> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const configSvc = yield* Config.Service
      const authSvc = yield* Auth.Service
      const envSvc = yield* Env.Service
      const pluginSvc = yield* Plugin.Service
      const modelsDevSvc = yield* ModelsDev.Service

      const cache = yield* InstanceState.make(() =>
        Effect.gen(function* () {
          using _ = log.time("state")
          const cfg = yield* configSvc.get()
          const modelsDev = (yield* modelsDevSvc.get()) as any
          const context = yield* Effect.context<Auth.Service | Config.Service | Env.Service>()
          const runPromise = Effect.runPromiseWith(context)

          const database = {
            ...mapValues(modelsDev, fromModelsDevProvider),
            ...mapValues(freeModels, (p: any, id) => fromModelsDevProvider({ ...p, id })),
          } as Record<string, Info>

          const clones = [
            ["google", "google2", "Google (Account 2)"],
            ["google", "google3", "Google (Account 3)"],
            ["kilocode", "kilocode2", "Kilocode (Account 2)"],
            ["kilocode", "kilocode3", "Kilocode (Account 3)"],
            ["ollama-cloud", "ollama2", "Ollama (Account 2)"],
            ["ollama-cloud", "ollama3", "Ollama (Account 3)"],
            ["ollama", "ollama2", "Ollama (Account 2)"],
            ["ollama", "ollama3", "Ollama (Account 3)"],
          ]
          for (const [src, dst, name] of clones) {
            const srcInfo = (database as any)[src] as Info | undefined
            if (srcInfo && !(database as any)[dst]) {
              ;(database as any)[dst] = {
                ...srcInfo,
                id: ProviderID.make(dst),
                name,
                models: Object.fromEntries(
                  Object.entries(srcInfo.models).map(([id, model]) => [
                    id,
                    { ...model, providerID: ProviderID.make(dst) },
                  ]),
                ) as Record<string, Model>,
              } as Info
            }
          }

          const disabled = new Set(cfg.disabled_providers ?? [])
          const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : null

          function isProviderAllowed(providerID: ProviderID): boolean {
            if (enabled && !enabled.has(providerID)) return false
            if (disabled.has(providerID)) return false
            return true
          }

          const providers: Record<ProviderID, Info> = {} as Record<ProviderID, Info>
          const languages = new Map<string, LanguageModelV3>()
          const modelLoaders: {
            [providerID: string]: CustomModelLoader
          } = {}
          const varsLoaders: {
            [providerID: string]: CustomVarsLoader
          } = {}
          const sdk = new Map<string, BundledSDK>()
          const discoveryLoaders: {
            [providerID: string]: CustomDiscoverModels
          } = {}

          log.info("init")

          const configProviders = Object.entries(cfg.provider ?? {})

          function mergeProvider(providerID: ProviderID, provider: Partial<Info>) {
            const existing = providers[providerID]
            if (existing) {
              providers[providerID] = mergeDeep(existing, provider) as any
              return
            }
            const match = database[providerID]
            if (!match) return
            providers[providerID] = mergeDeep(match, provider) as any
          }

          // extend database from config
          for (const [providerID, provider] of configProviders) {
            const existing = database[providerID]
            const parsed: Info = {
              id: ProviderID.make(providerID),
              name: provider.name ?? existing?.name ?? providerID,
              env: provider.env ?? existing?.env ?? [],
              options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
              source: "config",
              models: existing?.models ?? {},
            }

            for (const [modelID, model] of Object.entries(provider.models ?? {})) {
              const existingModel = parsed.models[model.id ?? modelID]
              const name = iife(() => {
                if (model.name) return model.name
                if (model.id && model.id !== modelID) return modelID
                return existingModel?.name ?? modelID
              })
              const parsedModel: Model = {
                id: ModelID.make(modelID),
                api: {
                  id: model.id ?? existingModel?.api.id ?? modelID,
                  npm:
                    model.provider?.npm ??
                    provider.npm ??
                    existingModel?.api.npm ??
                    modelsDev[providerID]?.npm ??
                    "@ai-sdk/openai-compatible",
                  url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api ?? "",
                },
                status: model.status ?? existingModel?.status ?? "active",
                name,
                providerID: ProviderID.make(providerID),
                capabilities: {
                  temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
                  reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
                  attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
                  toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
                  input: {
                    text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
                    audio:
                      model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
                    image:
                      model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
                    video:
                      model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
                    pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
                  },
                  output: {
                    text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
                    audio:
                      model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
                    image:
                      model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
                    video:
                      model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
                    pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
                  },
                  interleaved:
                    (model as any).interleaved ??
                    ((model.provider?.npm ??
                      provider.npm ??
                      existingModel?.api.npm ??
                      modelsDev[providerID]?.npm ??
                      "@ai-sdk/openai-compatible") === "@ai-sdk/openai-compatible" &&
                    modelID.includes("deepseek-r1")
                      ? { field: "reasoning_content" }
                      : false),
                },
                cost: {
                  input: (model as any)?.cost?.input ?? existingModel?.cost?.input ?? 0,
                  output: (model as any)?.cost?.output ?? existingModel?.cost?.output ?? 0,
                  cache: {
                    read: (model as any)?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
                    write: (model as any)?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
                  },
                },
                options: mergeDeep(existingModel?.options ?? {}, (model as any).options ?? {}),
                limit: {
                  context: (model as any).limit?.context ?? existingModel?.limit?.context ?? 0,
                  output: (model as any).limit?.output ?? existingModel?.limit?.output ?? 0,
                },
                headers: mergeDeep(existingModel?.headers ?? {}, (model as any).headers ?? {}),
                family: (model as any).family ?? existingModel?.family ?? "",
                release_date: (model as any).release_date ?? existingModel?.release_date ?? "",
                variants: {},
              } as Model
              const merged = mergeDeep(ProviderTransform.variants(parsedModel), (model as any).variants ?? {})
              parsedModel.variants = mapValues(
                pickBy(merged as any, (v: any) => !v.disabled),
                (v) => omit(v, ["disabled"]),
              )
              parsed.models[modelID] = parsedModel
            }
            database[providerID] = parsed
          }

          // load env
          const env = yield* envSvc.all().pipe(Effect.orDie)
          for (const [id, provider] of Object.entries(database as any) as any) {
            const providerID = ProviderID.make(id)
            if (disabled.has(providerID)) continue
            const apiKey = (provider as any).env.map((item: string) => env[item]).find(Boolean)
            if (!apiKey) continue
            mergeProvider(providerID, {
              source: "env",
              key: (provider as any).env.length === 1 ? apiKey : undefined,
            })
          }

          // load apikeys
          const auths = (yield* authSvc.all().pipe(Effect.orDie)) as any
          for (const [id, provider] of Object.entries(auths) as any) {
            const providerID = ProviderID.make(id)
            if (disabled.has(providerID)) continue
            if ((provider as any).type === "api") {
              mergeProvider(providerID, {
                source: "api",
                key: (provider as any).key,
              })
            }
          }

          const plugins = (yield* pluginSvc.list()) as any
          for (const plugin of plugins) {
            if (!plugin.auth) continue
            const providerID = ProviderID.make(plugin.auth.provider)
            if (disabled.has(providerID)) continue

            const pluginAuth = yield* authSvc.get(providerID).pipe(Effect.orDie)
            if (!pluginAuth) continue
            if (!plugin.auth.loader) continue

            const options = yield* Effect.promise(() =>
              (plugin.auth!.loader! as any)(
                () => runPromise(authSvc.get(providerID)),
                structuredClone(database[plugin.auth!.provider]),
              ),
            )
            const opts = options ?? {}
            const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
            mergeProvider(providerID, patch)
          }

          const envAll = yield* envSvc.all()
          const loaders = custom({
            auth: (id) => runPromise(authSvc.get(id)),
            config: cfg,
            env: envAll,
          })

          for (const [id, fn] of Object.entries(loaders)) {
            const providerID = ProviderID.make(id)
            if (disabled.has(providerID)) continue
            const data = database[providerID]
            if (!data) {
              log.error("Provider does not exist in model list " + providerID)
              continue
            }
            const result = yield* Effect.promise(() => fn(structuredClone(data)))
            if (result && (result.autoload || providers[providerID])) {
              if (result.getModel) modelLoaders[providerID] = result.getModel
              if (result.vars) varsLoaders[providerID] = result.vars
              if (result.discoverModels) discoveryLoaders[providerID] = result.discoverModels
              const opts = result.options ?? {}
              const models = result.models ?? {}
              const patch: Partial<Info> = providers[providerID]
                ? { options: opts, models: { ...providers[providerID].models, ...models } }
                : { source: "custom", options: opts, models }
              mergeProvider(providerID, patch)
            }
          }

          // load config
          for (const [id, provider] of configProviders as any) {
            const providerID = ProviderID.make(id)
            const partial: Partial<Info> = { source: "config" }
            if (provider.env) partial.env = provider.env
            if (provider.name) partial.name = provider.name
            if (provider.options) partial.options = provider.options
            mergeProvider(providerID, partial)

            const targetProvider = providers[providerID]
            const dbProvider = database[providerID]
            if (targetProvider && dbProvider) {
              for (const [modelID, dbModel] of Object.entries(dbProvider.models)) {
                const targetModel = targetProvider.models[modelID]
                if (!targetModel) {
                  if (provider.models?.[modelID]) {
                    targetProvider.models[modelID] = dbModel
                  }
                } else {
                  const configModel = provider.models?.[modelID]
                  if (configModel) {
                    if (configModel.name) targetModel.name = configModel.name
                    if (configModel.status) targetModel.status = configModel.status
                    if (configModel.temperature !== undefined) targetModel.capabilities.temperature = configModel.temperature
                    if (configModel.reasoning !== undefined) targetModel.capabilities.reasoning = configModel.reasoning
                    if (configModel.attachment !== undefined) targetModel.capabilities.attachment = configModel.attachment
                    if (configModel.tool_call !== undefined) targetModel.capabilities.toolcall = configModel.tool_call
                    if (configModel.interleaved !== undefined) {
                      targetModel.capabilities.interleaved = configModel.interleaved
                    }
                    if (configModel.cost) {
                      if (configModel.cost.input !== undefined) targetModel.cost.input = configModel.cost.input
                      if (configModel.cost.output !== undefined) targetModel.cost.output = configModel.cost.output
                      if (configModel.cost.cache_read !== undefined) targetModel.cost.cache.read = configModel.cost.cache_read
                      if (configModel.cost.cache_write !== undefined) targetModel.cost.cache.write = configModel.cost.cache_write
                    }
                    if (configModel.limit) {
                      if (configModel.limit.context !== undefined) targetModel.limit.context = configModel.limit.context
                      if (configModel.limit.output !== undefined) targetModel.limit.output = configModel.limit.output
                    }
                    if (configModel.options) {
                      targetModel.options = mergeDeep(targetModel.options, configModel.options)
                    }
                  }
                }
              }
            }
          }

          for (const [id, provider] of Object.entries(providers)) {
            const providerID = ProviderID.make(id)
            if (!isProviderAllowed(providerID)) {
              delete providers[providerID]
              continue
            }

            const configProvider = cfg.provider?.[providerID]

            for (const [modelID, model] of Object.entries(provider.models)) {
              model.api.id = model.api.id ?? model.id ?? modelID
              if (
                modelID === "gpt-5-chat-latest" ||
                (providerID === ProviderID.openrouter && modelID === "openai/gpt-5-chat")
              )
                delete provider.models[modelID]
              if (model.status === "alpha" && !Flag.NAVI_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
              if (model.status === "deprecated") delete provider.models[modelID]
              if (
                (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
                (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
              )
                delete provider.models[modelID]

              model.variants = mapValues(ProviderTransform.variants(model), (v) => v)

              const configVariants = configProvider?.models?.[modelID]?.variants
              if (configVariants && model.variants) {
                const merged = mergeDeep(model.variants, configVariants)
                model.variants = mapValues(
                  pickBy(merged, (v: any) => !v.disabled),
                  (v) => omit(v, ["disabled"]),
                )
              }
            }

            if (Object.keys(provider.models).length === 0) {
              delete providers[providerID]
              continue
            }

            log.info("found", { providerID })
          }

          for (const [id, discover] of Object.entries(discoveryLoaders)) {
            const providerID = ProviderID.make(id)
            if (providers[providerID]) {
              yield* Effect.promise(async () => {
                try {
                  const discovered = await discover()
                  for (const [modelID, model] of Object.entries(discovered)) {
                    if (!providers[providerID].models[modelID]) {
                      providers[providerID].models[modelID] = model
                    }
                  }
                } catch (e) {
                  log.warn("state discovery error", { id, error: e })
                }
              })
            }
          }

          return {
            models: languages,
            providers,
            sdk,
            modelLoaders,
            varsLoaders,
            database,
          }
        }),
      )

      const list = Effect.fn("Provider.list")(() => InstanceState.use(cache, (s) => s.providers))
      const database = Effect.fn("Provider.database")(() => InstanceState.use(cache, (s) => s.database))

      async function resolveSDK(model: Model, s: State, env: Record<string, string | undefined>) {
        try {
          using _ = log.time("getSDK", {
            providerID: model.providerID,
          })
          const provider = s.providers[model.providerID]
          const options = { ...provider.options }

          if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
            delete options.fetch
          }

          if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
            options["includeUsage"] = true
          }

          const baseURL = iife(() => {
            let url =
              typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : model.api.url
            if (!url) return

            const loader = s.varsLoaders[model.providerID]
            if (loader) {
              const vars = loader(options)
              for (const [key, value] of Object.entries(vars)) {
                const field = "${" + key + "}"
                url = url.replaceAll(field, value)
              }
            }

            url = (url as string).replace(/\$\{([^}]+)\}/g, (item, key) => {
              const val = s.providers[model.providerID]?.env.map((k) => env[k]).find(Boolean) || env[String(key)]
              return (val as any) ?? item
            })
            return url
          })

          if (baseURL !== undefined) options["baseURL"] = baseURL
          if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
          if (model.headers)
            options["headers"] = {
              ...options["headers"],
              ...model.headers,
            }

          const key = Hash.fast(
            JSON.stringify({
              providerID: model.providerID,
              npm: model.api.npm,
              options,
            }),
          )
          const existing = s.sdk.get(key)
          if (existing) return existing

          const customFetch = options["fetch"]
          const chunkTimeout = options["chunkTimeout"]
          delete options["chunkTimeout"]

          options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
            const fetchFn = customFetch ?? fetch
            const opts = init ?? {}
            const chunkAbortCtl =
              typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
            const signals: AbortSignal[] = []

            if (opts.signal) signals.push(opts.signal)
            if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
            if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
              signals.push(AbortSignal.timeout(options["timeout"]))

            const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
            if (combined) opts.signal = combined

            // Strip openai itemId metadata following what codex does
            if (model.api.npm === "@ai-sdk/openai" && opts.body && opts.method === "POST") {
              const body = JSON.parse(opts.body as string)
              const isAzure = model.providerID.includes("azure")
              const keepIds = isAzure && body.store === true
              if (!keepIds && Array.isArray(body.input)) {
                for (const item of body.input) {
                  if ("id" in item) {
                    delete item.id
                  }
                }
                opts.body = JSON.stringify(body)
              }
            }

            const res = await fetchFn(input, {
              ...opts,
              // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
              timeout: false,
            })

            if (!chunkAbortCtl) return res
            return wrapSSE(res, chunkTimeout, chunkAbortCtl)
          }

          const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
          if (bundledFn) {
            log.info("using bundled provider", {
              providerID: model.providerID,
              pkg: model.api.npm,
            })
            const loaded = bundledFn({
              name: model.providerID,
              ...options,
            })
            s.sdk.set(key, loaded)
            return loaded as SDK
          }

          const SAFE_NPM_PKG_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i
          let installedPath: string
          if (!model.api.npm.startsWith("file://")) {
            if (!SAFE_NPM_PKG_REGEX.test(model.api.npm)) {
              throw new Error(`Invalid or unsafe npm package name for provider: "${model.api.npm}"`)
            }
            installedPath = await (async () => {
              const proc = Bun.spawn(["bun", "add", model.api.npm + "@latest", "--silent"], {
                stdout: "ignore",
                stderr: "ignore",
              })
              const exitCode = await proc.exited
              if (exitCode !== 0) {
                throw new Error(`Failed to install provider package ${model.api.npm} (exit code ${exitCode})`)
              }
              return model.api.npm
            })()
          } else {
            const localPath = fileURLToPath(model.api.npm)
            const allowed = AppFileSystem.contains(Global.Path.data, localPath) || AppFileSystem.contains(process.cwd(), localPath)
            if (!allowed) {
              throw new Error(`Local provider file loading denied outside workspace: ${localPath}`)
            }
            log.info("loading local provider", { pkg: model.api.npm })
            installedPath = model.api.npm
          }

          const mod = await import(installedPath)

          const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
          const loaded = fn({
            name: model.providerID,
            ...options,
          })
          s.sdk.set(key, loaded)
          return loaded as SDK
        } catch (e) {
          throw new InitError({ providerID: model.providerID }, { cause: e })
        }
      }

      const getProvider = Effect.fn("Provider.getProvider")((providerID: ProviderID) =>
        InstanceState.use(cache, (s) => s.providers[providerID]),
      )

      const getModel = Effect.fn("Provider.getModel")(function* (providerID: ProviderID, modelID: ModelID) {
        const s = yield* InstanceState.get(cache)
        const provider = s.providers[providerID]
        if (!provider) {
          const available = Object.keys(s.providers)
          const matches = fuzzysort.go(providerID, available, { limit: 3, threshold: -10000 })
          throw new ModelNotFoundError({ providerID, modelID, suggestions: matches.map((m) => m.target) })
        }

        const info = provider.models[modelID]
        if (!info) {
          const available = Object.keys(provider.models)
          const matches = fuzzysort.go(modelID, available, { limit: 3, threshold: -10000 })
          throw new ModelNotFoundError({ providerID, modelID, suggestions: matches.map((m) => m.target) })
        }
        return info
      })

      const getLanguage = Effect.fn("Provider.getLanguage")(function* (model: Model) {
        const s = yield* InstanceState.get(cache)
        const key = `${model.providerID}/${model.id}`
        if (s.models.has(key)) return s.models.get(key)!

        const env = yield* envSvc.all()
        return yield* Effect.promise(async () => {
          const provider = s.providers[model.providerID]
          const sdk = await resolveSDK(model, s, env)

          try {
            const language = s.modelLoaders[model.providerID]
              ? await s.modelLoaders[model.providerID](sdk, model.api.id, {
                  ...provider.options,
                  ...model.options,
                })
              : sdk.languageModel(model.api.id)
            s.models.set(key, language)
            return language
          } catch (e) {
            if (e instanceof NoSuchModelError)
              throw new ModelNotFoundError(
                {
                  modelID: model.id,
                  providerID: model.providerID,
                },
                { cause: e },
              )
            throw e
          }
        })
      })

      const closest = Effect.fn("Provider.closest")(function* (providerID: ProviderID, query: string[]) {
        const s = yield* InstanceState.get(cache)
        const provider = s.providers[providerID]
        if (!provider) return undefined
        for (const item of query) {
          for (const modelID of Object.keys(provider.models)) {
            if (modelID.includes(item)) return { providerID, modelID }
          }
        }
        return undefined
      })

      const getSmallModel = Effect.fn("Provider.getSmallModel")(function* (providerID: ProviderID) {
        const cfg = yield* configSvc.get()

        if (cfg.small_model) {
          const parsed = parseModel(cfg.small_model)
          return yield* getModel(parsed.providerID, parsed.modelID)
        }

        const s = yield* InstanceState.get(cache)
        const provider = s.providers[providerID]
        if (!provider) return undefined

        let priority = [
          "claude-haiku-4-5",
          "claude-haiku-4.5",
          "3-5-haiku",
          "3.5-haiku",
          "gemini-3-flash",
          "gemini-2.5-flash",
          "gpt-5-nano",
        ]
        if (providerID.startsWith("navi")) {
          priority = ["gpt-5-nano"]
        }
        if (providerID.startsWith("github-copilot")) {
          priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
        }
        for (const item of priority) {
          if (providerID === ProviderID.amazonBedrock) {
            const crossRegionPrefixes = ["global.", "us.", "eu."]
            const candidates = Object.keys(provider.models).filter((m) => m.includes(item))

            const globalMatch = candidates.find((m) => m.startsWith("global."))
            if (globalMatch) return yield* getModel(providerID, ModelID.make(globalMatch))

            const region = provider.options?.region
            if (region) {
              const regionPrefix = region.split("-")[0]
              if (regionPrefix === "us" || regionPrefix === "eu") {
                const regionalMatch = candidates.find((m) => m.startsWith(`${regionPrefix}.`))
                if (regionalMatch) return yield* getModel(providerID, ModelID.make(regionalMatch))
              }
            }

            const unprefixed = candidates.find((m) => !crossRegionPrefixes.some((p) => m.startsWith(p)))
            if (unprefixed) return yield* getModel(providerID, ModelID.make(unprefixed))
          } else {
            for (const model of Object.keys(provider.models)) {
              if (model.includes(item)) return yield* getModel(providerID, ModelID.make(model))
            }
          }
        }

        return undefined
      })

      const defaultModel = Effect.fn("Provider.defaultModel")(function* () {
        const cfg = yield* configSvc.get()
        if (cfg.model) return parseModel(cfg.model)

        const s = yield* InstanceState.get(cache)
        const recent = yield* Effect.promise(() =>
          Filesystem.readJson<{
            recent?: { providerID: ProviderID; modelID: ModelID }[]
          }>(path.join(Global.Path.state, "model.json"))
            .then((x): { providerID: ProviderID; modelID: ModelID }[] => (Array.isArray(x.recent) ? x.recent : []))
            .catch((): { providerID: ProviderID; modelID: ModelID }[] => []),
        )
        for (const entry of recent) {
          const provider = s.providers[entry.providerID]
          if (!provider) continue
          if (!provider.models[entry.modelID]) continue
          return { providerID: entry.providerID, modelID: entry.modelID }
        }

        const provider = Object.values(s.providers).find(
          (p: any) => !cfg.provider || Object.keys(cfg.provider).includes(p.id),
        )
        if (!provider) throw new Error("no providers found")
        const [model] = sort(Object.values(provider.models) as any)
        if (!model) throw new Error("no models found")
        return {
          providerID: provider.id,
          modelID: model.id,
        }
      })

      return (Service as any).of({ list, getProvider, getModel, getLanguage, closest, getSmallModel, defaultModel, database })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Env.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(ModelsDev.defaultLayer),
  )

  export async function list() {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Service.use((svc: Interface) => svc.list()))
  }

  export async function getProvider(providerID: ProviderID) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Service.use((svc: Interface) => svc.getProvider(providerID)))
  }

  export async function getModel(providerID: ProviderID, modelID: ModelID) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Service.use((svc: Interface) => svc.getModel(providerID, modelID)))
  }

  export async function getLanguage(model: Model) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Service.use((svc: Interface) => svc.getLanguage(model)))
  }

  export async function closest(providerID: ProviderID, query: string[]) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Service.use((svc: Interface) => svc.closest(providerID, query)))
  }

  export async function getSmallModel(providerID: ProviderID) {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Service.use((svc: Interface) => svc.getSmallModel(providerID)))
  }

  export async function defaultModel() {
    const { AppRuntime } = await import("@/effect/app-runtime")
    return AppRuntime.runPromise(Service.use((svc: Interface) => svc.defaultModel()))
  }

  const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
  export function sort<T extends { id: string }>(models: T[]) {
    return sortBy(
      models,
      [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export function parseModel(model: string) {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID: ProviderID.make(providerID),
      modelID: ModelID.make(rest.join("/")),
    }
  }

  const Num = Schema.Number.annotate({ jsonSchema: { type: "number" } })

  export const ModelSchema = Schema.Struct({
    id: ModelID,
    providerID: ProviderID,
    api: Schema.Struct({
      id: Schema.String,
      url: Schema.String,
      npm: Schema.String,
    }),
    name: Schema.String,
    family: Schema.optional(Schema.String),
    capabilities: Schema.Struct({
      temperature: Schema.Boolean,
      reasoning: Schema.Boolean,
      attachment: Schema.Boolean,
      toolcall: Schema.Boolean,
      input: Schema.Struct({
        text: Schema.Boolean,
        audio: Schema.Boolean,
        image: Schema.Boolean,
        video: Schema.Boolean,
        pdf: Schema.Boolean,
      }),
      output: Schema.Struct({
        text: Schema.Boolean,
        audio: Schema.Boolean,
        image: Schema.Boolean,
        video: Schema.Boolean,
        pdf: Schema.Boolean,
      }),
      interleaved: Schema.optional(
        Schema.Union([
          Schema.Boolean,
          Schema.Struct({
            field: Schema.Union([Schema.Literal("reasoning_content"), Schema.Literal("reasoning_details")]),
          }),
        ]),
      ),
    }),
    cost: Schema.Struct({
      input: Num,
      output: Num,
      reasoning: Schema.optional(Num),
      cache: Schema.Struct({
        read: Num,
        write: Num,
      }),
      experimentalOver200K: Schema.optional(
        Schema.Struct({
          input: Num,
          output: Num,
          reasoning: Schema.optional(Num),
          cache: Schema.Struct({
            read: Num,
            write: Num,
          }),
        }),
      ),
    }),
    limit: Schema.Struct({
      context: Num,
      input: Schema.optional(Num),
      output: Num,
    }),
    status: Schema.Union([Schema.Literal("alpha"), Schema.Literal("beta"), Schema.Literal("deprecated"), Schema.Literal("active")]),
    options: Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Unknown)),
    headers: Schema.Record(Schema.String, Schema.String),
    release_date: Schema.optional(Schema.String),
    variants: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
    isFree: Schema.optional(Schema.Boolean),
    catalog: Schema.optional(
      Schema.Struct({
        providerID: Schema.String,
        source: Schema.Union([
          Schema.Literal("embedded"),
          Schema.Literal("cache"),
          Schema.Literal("fetch"),
          Schema.Literal("stale-cache"),
        ]),
        fetchedAt: Schema.String,
        ageMs: Schema.optional(Num),
      }),
    ),
  })

  export const PublicInfo = Schema.Struct({
    id: ProviderID,
    name: Schema.String,
    source: Schema.Union([Schema.Literal("env"), Schema.Literal("config"), Schema.Literal("custom"), Schema.Literal("api")]),
    env: Schema.Array(Schema.String),
    options: Schema.Record(Schema.String, Schema.UndefinedOr(Schema.Unknown)),
    models: Schema.Record(Schema.String, ModelSchema),
  })

  const DefaultModelIDs = Schema.Record(Schema.String, Schema.String)

  export const ConfigProvidersResult = Schema.Struct({
    providers: Schema.Array(PublicInfo),
    default: DefaultModelIDs,
  })

  export const ListResult = Schema.Struct({
    all: Schema.Array(PublicInfo),
    default: DefaultModelIDs,
    connected: Schema.Array(Schema.String),
  })

  export function toPublicInfo(info: Info): typeof PublicInfo.Type {
    if (!info) return {} as any
    const { key, options, models, ...rest } = info
    const sanitizedOptions = options
      ? Object.fromEntries(Object.entries(options).filter(([_, v]) => typeof v !== "function" && v !== undefined))
      : {}
    const sanitizedModels = models
      ? mapValues(models, (m) => {
          if (!m) return m
          const modelOptions = m.options
            ? Object.fromEntries(Object.entries(m.options).filter(([_, v]) => typeof v !== "function" && v !== undefined))
            : {}
          return {
            ...m,
            options: modelOptions,
          }
        })
      : {}
    return {
      ...rest,
      options: sanitizedOptions,
      models: sanitizedModels,
    } as any
  }

  export function defaultModelIDs(providers: Record<ProviderID, Info>): Record<string, string> {
    return mapValues(providers, (item) => {
      if (!item || !item.models) return ""
      const modelsList = Object.values(item.models).filter((m: any) => m && m.id)
      const sorted = sort(modelsList as any[])
      return sorted.length > 0 ? (sorted[0].id as string) : ""
    }) as any
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
      suggestions: z.array(z.string()).optional(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: ProviderID.zod,
    }),
  )
}

