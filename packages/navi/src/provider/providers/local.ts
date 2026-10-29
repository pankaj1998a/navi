import type { ProviderLoader } from "../loader"
import { ModelID, ProviderID } from "../schema"
import { Provider } from "../provider"

export interface LocalModelSpec {
    id: string
    name?: string
    tools?: boolean
    vision?: boolean
    context?: number | null
}

export function createLocalProvider<Discovered>(input: {
    providerID: string
    origin: string
    discover: (baseURL: string, apiKey?: string) => Promise<readonly Discovered[]>
    model: (item: Discovered) => LocalModelSpec
}): ProviderLoader.Info {
    return {
        async load(_provider, dep) {
            const configured = dep.config.provider?.[input.providerID]?.options as
                | { baseURL?: unknown; apiKey?: unknown }
                | undefined
            const baseURL = (
                typeof configured?.baseURL === "string" ? configured.baseURL : `${input.origin}/v1`
            ).replace(/\/+$/, "")
            const apiKey = typeof configured?.apiKey === "string" ? configured.apiKey : undefined

            let discovered: readonly Discovered[] = []
            try {
                discovered = await input.discover(baseURL, apiKey)
            } catch {
                return { autoload: false, options: {} }
            }

            const models: Record<string, Provider.Model> = {}
            for (const item of discovered) {
                const spec = input.model(item)
                const id = ModelID.make(spec.id)
                models[id] = {
                    id,
                    providerID: ProviderID.make(input.providerID),
                    name: spec.name || spec.id,
                    api: { id: spec.id, url: baseURL, npm: "@ai-sdk/openai-compatible" },
                    status: "active",
                    capabilities: {
                        temperature: true,
                        reasoning: false,
                        attachment: !!spec.vision,
                        toolcall: spec.tools ?? false,
                        input: { text: true, audio: false, image: !!spec.vision, video: false, pdf: false },
                        output: { text: true, audio: false, image: false, video: false, pdf: false },
                        interleaved: false,
                    },
                    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                    limit: {
                        context: typeof spec.context === "number" && spec.context > 0 ? spec.context : 0,
                        output: 0,
                    },
                    options: {},
                    headers: {},
                    release_date: new Date().toISOString(),
                    variants: {},
                }
            }

            return {
                autoload: discovered.length > 0,
                options: { baseURL, ...(apiKey ? { apiKey } : {}) },
                models,
            }
        },
    }
}
