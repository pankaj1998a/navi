import z from "zod"
import * as fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, type Provider as SDK } from "ai"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Plugin } from "../plugin"
import { ModelsDev } from "./models"
import { NamedError } from "@navi-ai/sdk/util/error"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import { invalidateCache as invalidateModelCache } from "./model-cache"
import { ProviderDiagnostics } from "./diagnostics"

// Direct imports removed for lazy loading
import { ProviderTransform } from "./transform"
import { ProviderLoader } from "./loader"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  const PROVIDER_ALIASES: Record<string, string> = {
    "claude-code": "anthropic",
    "qwen-code": "qwen-cli",
  }

  function resolveProviderAlias(providerID: string): string {
    return PROVIDER_ALIASES[providerID] ?? providerID
  }

  // Registry for lazy loading providers
  const REGISTRY: Record<string, () => Promise<ProviderLoader.Info>> = {
    "anthropic": async () => (await import("./providers/anthropic")).AnthropicProvider,
    "openai": async () => (await import("./providers/openai")).OpenAIProvider,
    "opencode": async () => (await import("./providers/opencode")).OpencodeProvider,
    "kilocode": async () => (await import("./providers/kilocode")).KilocodeProvider,
    "cline": async () => (await import("./providers/cline")).ClineProvider,
    "roocode": async () => (await import("./providers/roocode")).RoocodeProvider,
    "navi": async () => (await import("./providers/navi")).NaviProvider,
    "amazon-bedrock": async () => (await import("./providers/amazon-bedrock")).AmazonBedrockProvider,
    "github-copilot": async () => (await import("./providers/github-copilot")).GitHubCopilotProvider,
    "github-copilot-enterprise": async () => (await import("./providers/github-copilot")).GitHubCopilotEnterpriseProvider,
    "azure": async () => (await import("./providers/azure")).AzureProvider,
    "azure-cognitive-services": async () => (await import("./providers/azure")).AzureCognitiveServicesProvider,
    "google-vertex": async () => (await import("./providers/google-vertex")).GoogleVertexProvider,
    "google-vertex-anthropic": async () => (await import("./providers/google-vertex")).GoogleVertexAnthropicProvider,
    "google-antigravity": async () => (await import("./providers/google-antigravity")).GoogleAntigravityProvider,
    "gemini-cli": async () => (await import("./providers/gemini-cli")).GeminiCliProvider,
    "qwen-cli": async () => (await import("./providers/qwen-cli")).QwenCliProvider,
    "openrouter": async () => (await import("./providers/misc")).OpenrouterProvider,
    "vercel": async () => (await import("./providers/misc")).VercelProvider,
    "aihubmix": async () => (await import("./providers/misc")).AihubmixProvider,
    "cloudflare-ai-gateway": async () => (await import("./providers/cloudflare")).CloudflareAiGatewayProvider,
    "sap-ai-core": async () => (await import("./providers/enterprise")).SapAiCoreProvider,
    "zenmux": async () => (await import("./providers/enterprise")).ZenmuxProvider,
    "cerebras": async () => (await import("./providers/enterprise")).CerebrasProvider,
    "gitlab": async () => (await import("./providers/gitlab")).GitLabProvider,
    "cohere": async () => (await import("./providers/cohere")).CohereProvider,
    "togetherai": async () => (await import("./providers/togetherai")).TogetherAIProvider,
    "perplexity": async () => (await import("./providers/perplexity")).PerplexityProvider,
    "xai": async () => (await import("./providers/xai")).XaiProvider,
    "groq": async () => (await import("./providers/groq")).GroqProvider,
    "mistral": async () => (await import("./providers/mistral")).MistralProvider,
    "deepinfra": async () => (await import("./providers/deepinfra")).DeepInfraProvider,
    "baseten": async () => (await import("./providers/baseten")).BasetenProvider,
    "deepseek": async () => (await import("./providers/deepseek")).DeepSeekProvider,
    "fireworks": async () => (await import("./providers/fireworks")).FireworksProvider,
    "huggingface": async () => (await import("./providers/huggingface")).HuggingFaceProvider,
    "lm-studio": async () => (await import("./providers/lm-studio")).LmStudioProvider,
    "minimax": async () => (await import("./providers/minimax")).MiniMaxProvider,
    "moonshot": async () => (await import("./providers/moonshot")).MoonShotProvider,
  }

  const BUNDLED_PROVIDERS_REGISTRY: Record<string, () => Promise<(options: any) => SDK>> = {
    "@ai-sdk/amazon-bedrock": async () => (await import("@ai-sdk/amazon-bedrock")).createAmazonBedrock,
    "@ai-sdk/anthropic": async () => (await import("@ai-sdk/anthropic")).createAnthropic,
    "@ai-sdk/azure": async () => (await import("@ai-sdk/azure")).createAzure,
    "@ai-sdk/google": async () => (await import("@ai-sdk/google")).createGoogleGenerativeAI,
    "@ai-sdk/google-vertex": async () => (await import("@ai-sdk/google-vertex")).createVertex,
    "@ai-sdk/google-vertex/anthropic": async () => (await import("@ai-sdk/google-vertex/anthropic")).createVertexAnthropic,
    "@ai-sdk/openai": async () => (await import("@ai-sdk/openai")).createOpenAI,
    "@ai-sdk/openai-compatible": async () => (await import("@ai-sdk/openai-compatible")).createOpenAICompatible,
    "@openrouter/ai-sdk-provider": async () => (await import("@openrouter/ai-sdk-provider")).createOpenRouter,
    "@ai-sdk/xai": async () => (await import("@ai-sdk/xai")).createXai,
    "@ai-sdk/mistral": async () => (await import("@ai-sdk/mistral")).createMistral,
    "@ai-sdk/groq": async () => (await import("@ai-sdk/groq")).createGroq,
    "@ai-sdk/deepinfra": async () => (await import("@ai-sdk/deepinfra")).createDeepInfra,
    "@ai-sdk/cerebras": async () => (await import("@ai-sdk/cerebras")).createCerebras,
    "@ai-sdk/cohere": async () => (await import("@ai-sdk/cohere")).createCohere,
    "@ai-sdk/gateway": async () => (await import("@ai-sdk/gateway")).createGateway,
    "@ai-sdk/togetherai": async () => (await import("@ai-sdk/togetherai")).createTogetherAI,
    "@ai-sdk/perplexity": async () => (await import("@ai-sdk/perplexity")).createPerplexity,
    "@ai-sdk/vercel": async () => (await import("@ai-sdk/vercel")).createVercel,
    "@ai-sdk/fireworks": async () => (await import("@ai-sdk/fireworks")).createFireworks,
    "@ai-sdk/github-copilot": async () => (await import("./sdk/openai-compatible/src")).createOpenaiCompatible as unknown as (options: any) => SDK,
    "@gitlab/gitlab-ai-provider": async () => (await import("@gitlab/gitlab-ai-provider")).createGitLab,
  }

  export type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>

  export async function loadCustom(providerID: string, info: Info): Promise<ProviderLoader.Result | undefined> {
    const loaderFn = REGISTRY[providerID]
    if (!loaderFn) return undefined
    const loader = await loaderFn()
    return await loader.load(info)
  }

  export async function getBundledFactory(npm: string): Promise<((options: any) => SDK) | undefined> {
    const loader = BUNDLED_PROVIDERS_REGISTRY[npm]
    if (!loader) return undefined
    return await loader()
  }


  export const Model = z
    .object({
      id: z.string(),
      providerID: z.string(),
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
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        output: z.number(),
      }),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()),
      release_date: z.string(),
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
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: z.string(),
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api", "free"]),
      env: z.string().array(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()),
      models: z.record(z.string(), Model),
      catalog: z
        .object({
          source: z.enum(["embedded", "cache"]),
          fetchedAt: z.string(),
          ageMs: z.number().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
      id: model.id,
      providerID: provider.id,
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: provider.api!,
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
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
          }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolcall: model.tool_call,
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
      isFree: model.isFree ?? (model.cost?.input === 0 && model.cost?.output === 0),
      release_date: model.release_date,
      variants: {},
      catalog: model.catalog,
    }

    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
  }

  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
      id: provider.id,
      source: "custom",
      name: provider.name,
      env: provider.env ?? [],
      options: {},
      catalog: provider.catalog,
      models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
  }

  // Store the init function reference for refresh capability
  const stateInit = async () => {
    using _ = log.time("state")
    const config = await Config.get()
    const modelsDev = await ModelsDev.get()

    const database = mapValues(modelsDev, fromModelsDevProvider)

    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null

    function isProviderAllowed(providerID: string): boolean {
      if (enabled && !enabled.has(providerID)) return false
      if (disabled.has(providerID)) return false
      return true
    }

    const providers: { [providerID: string]: Info } = {}
    const languages = new Map<string, LanguageModelV2>()
    const modelLoaders: {
      [providerID: string]: CustomModelLoader
    } = {}
    const sdk = new Map<number, SDK>()

    log.info("init")

    const configProviders = Object.entries(config.provider ?? {})

    // Add GitHub Copilot Enterprise provider that inherits from GitHub Copilot
    if (database["github-copilot"]) {
      const githubCopilot = database["github-copilot"]
      database["github-copilot-enterprise"] = {
        ...githubCopilot,
        id: "github-copilot-enterprise",
        name: "GitHub Copilot Enterprise",
        models: mapValues(githubCopilot.models, (model) => ({
          ...model,
          providerID: "github-copilot-enterprise",
        })),
      }
    }

    function mergeProvider(providerID: string, provider: Partial<Info>) {
      const existing = providers[providerID]
      if (existing) {

        // @ts-expect-error
        providers[providerID] = mergeDeep(existing, provider)
        return
      }
      const match = database[providerID]
      if (!match) return

      // @ts-expect-error
      providers[providerID] = mergeDeep(match, provider)
    }

    // extend database from config
    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID]
      const parsed: Info = {
        id: providerID,
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
          id: modelID,
          api: {
            id: model.id ?? existingModel?.api.id ?? modelID,
            npm:
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api.npm ??
              (providerID === "gemini-cli" ? "@ai-sdk/google" : modelsDev[providerID]?.npm) ??
              "@ai-sdk/openai-compatible",
            url: provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
          },
          status: model.status ?? existingModel?.status ?? "active",
          name,
          providerID,
          capabilities: {
            temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
            reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
            attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
            toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
            input: {
              text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
              audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
              image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
              video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
              pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
            },
            output: {
              text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
              audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
              image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
              video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
              pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
            },
            interleaved: model.interleaved ?? false,
          },
          cost: {
            input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
            output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
            cache: {
              read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
              write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
            },
          },
          options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
          limit: {
            context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
            output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
          },
          headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
          family: model.family ?? existingModel?.family ?? "",
          release_date: model.release_date ?? existingModel?.release_date ?? "",
          variants: {},
        }
        const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
        parsedModel.variants = mapValues(
          pickBy(merged, (v: any) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
        parsed.models[modelID] = parsedModel
      }
      database[providerID] = parsed
    }

    // load env
    const env = Env.all()
    for (const [providerID, provider] of Object.entries(database)) {
      if (disabled.has(providerID)) continue
      const apiKey = provider.env.map((item) => env[item]).find(Boolean)
      if (apiKey) {
        mergeProvider(providerID, {
          source: "env",
          key: provider.env.length === 1 ? apiKey : undefined,
        })
      } else {
        // Check if provider has free models (cost.input === 0)
        const hasFreeModels = Object.values(provider.models).some((model) => model.cost?.input === 0)
        if (hasFreeModels) {
          mergeProvider(providerID, {
            source: "free",
          })
        }
      }
    }

    // load apikeys
    for (const [providerID, provider] of Object.entries(await Auth.all())) {
      if (disabled.has(providerID)) continue
      if (provider.type === "api") {
        mergeProvider(providerID, {
          source: "api",
          key: provider.key,
        })
      }
    }

    for (const plugin of await Plugin.list()) {
      if (!plugin.auth) continue
      const providerID = plugin.auth.provider
      if (disabled.has(providerID)) continue

      // For github-copilot plugin, check if auth exists for either github-copilot or github-copilot-enterprise
      let hasAuth = false
      const auth = await Auth.get(providerID)
      if (auth) hasAuth = true

      // Special handling for github-copilot: also check for enterprise auth
      if (providerID === "github-copilot" && !hasAuth) {
        const enterpriseAuth = await Auth.get("github-copilot-enterprise")
        if (enterpriseAuth) hasAuth = true
      }

      if (!hasAuth) continue
      if (!plugin.auth.loader) continue

      // Load for the main provider if auth exists
      if (auth) {
        const options = await plugin.auth.loader(() => Auth.get(providerID) as any, database[plugin.auth.provider])
        mergeProvider(plugin.auth.provider, {
          source: "custom",
          options: options,
        })
      }

      // If this is github-copilot plugin, also register for github-copilot-enterprise if auth exists
      if (providerID === "github-copilot") {
        const enterpriseProviderID = "github-copilot-enterprise"
        if (!disabled.has(enterpriseProviderID)) {
          const enterpriseAuth = await Auth.get(enterpriseProviderID)
          if (enterpriseAuth) {
            const enterpriseOptions = await plugin.auth.loader(
              () => Auth.get(enterpriseProviderID) as any,
              database[enterpriseProviderID],
            )
            mergeProvider(enterpriseProviderID, {
              source: "custom",
              options: enterpriseOptions,
            })
          }
        }
      }
    }

    for (const providerID of Object.keys(REGISTRY)) {
      if (disabled.has(providerID)) continue
      try {
        const result = await loadCustom(providerID, database[providerID])
        if (result && (result.autoload || providers[providerID])) {
          if (result.getModel) modelLoaders[providerID] = result.getModel

          const update: any = {
            source: "custom",
            options: result.options,
          }
          if (result.models) update.models = result.models

          mergeProvider(providerID, update)
        }
      } catch (e) {
        log.warn("failed to load custom provider", { providerID, error: e })
      }
    }

    // load config
    for (const [providerID, provider] of configProviders) {
      const partial: Partial<Info> = { source: "config" }
      if (provider.env) partial.env = provider.env
      if (provider.name) partial.name = provider.name
      if (provider.options) partial.options = provider.options
      mergeProvider(providerID, partial)
    }

    for (const [providerID, provider] of Object.entries(providers)) {
      if (!isProviderAllowed(providerID)) {
        delete providers[providerID]
        continue
      }

      if (providerID === "github-copilot" || providerID === "github-copilot-enterprise") {
        if (provider.models) {
          provider.models = mapValues(provider.models, (model) => ({
            ...model,
            api: {
              ...model.api,
              npm: "@ai-sdk/github-copilot",
            },
          }))
        }
      }

      const configProvider = config.provider?.[providerID]

      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        model.api.id = model.api.id ?? model.id ?? modelID
        if (modelID === "gpt-5-chat-latest" || (providerID === "openrouter" && modelID === "openai/gpt-5-chat"))
          delete provider.models[modelID]
        if (model.status === "alpha" && !Flag.NAVI_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
        if (model.status === "deprecated") delete provider.models[modelID]
        if (
          (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
          (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
        )
          delete provider.models[modelID]

        // Filter out disabled variants from config
        const configVariants = configProvider?.models?.[modelID]?.variants
        if (configVariants && model.variants) {
          const merged = mergeDeep(model.variants, configVariants)
          model.variants = mapValues(
            pickBy(merged, (v: any) => !v.disabled),
            (v) => omit(v, ["disabled"]),
          )
        }
      }

      if (Object.keys(provider.models ?? {}).length === 0) {
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    return {
      models: languages,
      providers,
      sdk,
      modelLoaders,
    }
  }

  const state = Instance.state(stateInit)

  /**
   * Refresh the provider state after authentication changes.
   * This should be called after OAuth authentication completes.
   *
   * @param providerID - When supplied, the model cache for this provider is
   *   invalidated so that fresh models are fetched on the next load.
   */
  export interface RefreshOptions {
    invalidateModelCache?: boolean
  }

  export async function refresh(providerID?: string, options?: RefreshOptions) {
    log.info("refreshing provider state", { providerID })
    const startedAt = Date.now()
    if (providerID && options?.invalidateModelCache !== false) {
      // Bust the per-provider model cache so live models are re-fetched
      await invalidateModelCache(providerID)
    }
    const { State } = await import("@/project/state")
    try {
      const result = await State.refresh(Instance.directory, stateInit)
      if (providerID) {
        const provider = (await list())[providerID]
        await ProviderDiagnostics.record({
          scope: "provider-refresh",
          providerID,
          status: "success",
          refreshedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          modelCount: provider ? Object.keys(provider.models ?? {}).length : undefined,
          reason: options?.invalidateModelCache === false ? "refresh without model cache invalidation" : "refresh after model cache invalidation",
        })
      }
      return result
    } catch (error) {
      if (providerID) {
        await ProviderDiagnostics.record({
          scope: "provider-refresh",
          providerID,
          status: "failure",
          refreshedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          reason: options?.invalidateModelCache === false ? "refresh without model cache invalidation" : "refresh after model cache invalidation",
        })
      }
      throw error
    }
  }

  /**
   * Refresh the state after a new API key is saved for a specific provider.
   * Invalidates the cached model list so it is re-fetched immediately.
   */
  export async function refreshProvider(providerID: string) {
    return refresh(providerID)
  }

  /**
   * Refresh provider state after a new credential is connected.
   * The model cache is invalidated only when the config allows automatic
   * refetching, but the provider state is always reloaded.
   */
  export async function refreshProviderOnConnect(providerID: string) {
    const config = await Config.get()
    return refresh(providerID, {
      invalidateModelCache: config.auto_fetch_models_on_connect !== false,
    })
  }

  export async function list() {
    return state().then((state) => state.providers)
  }

  async function getSDK(model: Model) {
    try {
      using _ = log.time("getSDK", {
        providerID: model.providerID,
      })
      const s = await state()
      const provider = s.providers[model.providerID]
      const options = { ...provider.options }

      if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
        options["includeUsage"] = true
      }

      if (!options["baseURL"]) options["baseURL"] = model.api.url
      if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
      if (model.headers)
        options["headers"] = {
          ...options["headers"],
          ...model.headers,
        }

      const key = Bun.hash.xxHash32(JSON.stringify({ npm: model.api.npm, options }))
      const existing = s.sdk.get(key)
      if (existing) return existing

      const customFetch = options["fetch"]

      options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
        // Preserve custom fetch if it exists, wrap it with timeout logic
        const fetchFn = customFetch ?? fetch
        const opts = init ?? {}

        if (options["timeout"] !== undefined && options["timeout"] !== null) {
          const signals: AbortSignal[] = []
          if (opts.signal) signals.push(opts.signal)
          if (options["timeout"] !== false) signals.push(AbortSignal.timeout(options["timeout"]))

          const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

          opts.signal = combined
        }

        return fetchFn(input, {
          ...opts,
          // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
          timeout: false,
        })
      }

      // Special case: google-vertex-anthropic uses a subpath import
      const bundledKey =
        model.providerID === "google-vertex-anthropic" ? "@ai-sdk/google-vertex/anthropic" : model.api.npm
      const bundledFn = await getBundledFactory(bundledKey)
      if (bundledFn) {
        log.info("using bundled provider", { providerID: model.providerID, pkg: bundledKey })
        const loaded = bundledFn({
          name: model.providerID,
          ...options,
        })
        s.sdk.set(key, loaded)
        return loaded as SDK
      }

      let installedPath: string
      if (!model.api.npm.startsWith("file://")) {
        installedPath = await BunProc.install(model.api.npm, "latest")
      } else {
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

  export async function getProvider(providerID: string) {
    return state().then((s) => s.providers[resolveProviderAlias(providerID)])
  }

  export async function getModel(providerID: string, modelID: string) {
    const s = await state()
    const resolvedProviderID = resolveProviderAlias(providerID)
    const provider = s.providers[resolvedProviderID]
    if (!provider) {
      const availableProviders = Object.keys(s.providers)
      const matches = fuzzysort.go(resolvedProviderID, availableProviders, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID: resolvedProviderID, modelID, suggestions })
    }

    const info = provider.models[modelID]
    if (!info) {
      const availableModels = Object.keys(provider.models)
      const matches = fuzzysort.go(modelID, availableModels, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }
    return info
  }

  export async function getLanguage(model: Model): Promise<LanguageModelV2> {
    const s = await state()
    const resolvedProviderID = resolveProviderAlias(model.providerID)
    const key = `${resolvedProviderID}/${model.id}`
    if (s.models.has(key)) return s.models.get(key)!

    const provider = s.providers[resolvedProviderID]
    const sdk = await getSDK(model)

    try {
      const language = s.modelLoaders[resolvedProviderID]
        ? await s.modelLoaders[resolvedProviderID](sdk, model.api.id, provider.options)
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
  }

  export async function closest(providerID: string, query: string[]) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) return undefined
    for (const item of query) {
      for (const modelID of Object.keys(provider.models)) {
        if (modelID.includes(item))
          return {
            providerID,
            modelID,
          }
      }
    }
  }

  export async function getSmallModel(providerID: string) {
    const cfg = await Config.get()

    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model)
      return getModel(parsed.providerID, parsed.modelID)
    }

    const provider = await state().then((state) => state.providers[providerID])
    if (provider) {
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
        // prioritize free models for github copilot
        priority = ["gpt-5-mini", "claude-haiku-4.5", ...priority]
      }
      if (providerID === "kilocode") {
        priority = ["kilo/auto", "giga-potato-thinking", "giga-potato", "z-ai/glm-5:free", "minimax/minimax-m2.5:free"]
      }
      for (const item of priority) {
        for (const model of Object.keys(provider.models)) {
          if (model.includes(item)) return getModel(providerID, model)
        }
      }
    }

    // Check if navi provider is available before using it
    const naviProvider = await state().then((state) => state.providers["navi"])
    if (naviProvider && naviProvider.models["gpt-5-nano"]) {
      return getModel("navi", "gpt-5-nano")
    }

    // Check if kilocode provider is available before using it
    const kilocodeProvider = await state().then((state) => state.providers["kilocode"])
    if (kilocodeProvider) {
      // Find any free model
      for (const [modelID, model] of Object.entries(kilocodeProvider.models)) {
        if (model.cost.input === 0 && model.cost.output === 0) {
          return getModel("kilocode", modelID)
        }
      }
    }

    return undefined
  }

  const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
  export function sort(models: Model[]) {
    return sortBy(
      models,
      [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)

    const provider = await list()
      .then((val) => Object.values(val))
      .then((x) => x.find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id)))
    if (!provider) throw new Error("no providers found")
    const [model] = sort(Object.values(provider.models))
    if (!model) throw new Error("no models found")
    return {
      providerID: provider.id,
      modelID: model.id,
    }
  }

  export function parseModel(model: string) {
    const [providerID, ...rest] = model.split("/")
    return {
      providerID: providerID,
      modelID: rest.join("/"),
    }
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: z.string(),
      modelID: z.string(),
      suggestions: z.array(z.string()).optional(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: z.string(),
    }),
  )
}
