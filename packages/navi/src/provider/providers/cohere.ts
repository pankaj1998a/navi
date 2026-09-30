import type { ProviderLoader } from "../loader"
import { ModelID, ProviderID } from "../schema"
import { Auth } from "../../auth"
import { Env } from "../../env"
import * as Log from "@navi-ai/core/util/log"
import { loadCachedModels, stampCatalog, writeCache } from "../model-cache"
import { Provider } from "../provider"
import { Installation } from "../../installation"

const PROVIDER_ID = "cohere"
const BASE_URL = "https://api.cohere.com/v2"
const NPM = "@ai-sdk/cohere"

const log = Log.create({ service: "cohere-provider" })

export const CohereProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const env = dep.env
        const envKey = (input?.env ?? ["COHERE_API_KEY"]).map((k) => env[k]).find(Boolean)
        const auth = await dep.auth(PROVIDER_ID)
        const config = dep.config
        const apiKey = envKey ?? (auth?.type === "api" ? auth.key : undefined) ?? config.provider?.[PROVIDER_ID]?.options?.apiKey

        const hasKey = !!apiKey

        const cacheState = await loadCachedModels(PROVIDER_ID, input?.models ? { ...input.models } : {})
        let models: Record<string, Provider.Model> = cacheState.models

        if (hasKey) {
            try {
                // Cohere uses a different models-list endpoint and response schema
                const res = await fetch("https://api.cohere.com/v2/models?default_only=false&endpoint=chat", {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "User-Agent": Installation.USER_AGENT,
                        Accept: "application/json",
                    },
                    signal: AbortSignal.timeout(10_000),
                })

                if (res.ok) {
                    const data = (await res.json()) as any
                    // Cohere returns { models: [...] }
                    const list: any[] = data?.models ?? []
                    const fetched: Record<string, Provider.Model> = {}

                    for (const raw of list) {
                        if (typeof raw.name !== "string") continue
                        const id: string = raw.name
                        fetched[id] = {
                            id: ModelID.make(id),
                            providerID: ProviderID.make(PROVIDER_ID),
                            name: raw.name,
                            api: { id, url: BASE_URL, npm: NPM },
                            status: raw.is_deprecated ? "deprecated" : "active",
                            capabilities: {
                                temperature: true,
                                reasoning: false,
                                attachment: false,
                                toolcall: true,
                                input: { text: true, audio: false, image: false, video: false, pdf: false },
                                output: { text: true, audio: false, image: false, video: false, pdf: false },
                                interleaved: false,
                            },
                            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                            limit: {
                                context: raw.context_length ?? 0,
                                output: 0,
                            },
                            options: {},
                            headers: {},
                            release_date: new Date().toISOString(),
                            isFree: false,
                            variants: {},
                        }
                    }

                    // Remove deprecated
                    for (const [k, v] of Object.entries(fetched)) {
                        if (v.status === "deprecated") delete fetched[k]
                    }

                    const stamped = stampCatalog(fetched, {
                        providerID: PROVIDER_ID,
                        source: "fetch",
                        fetchedAt: new Date().toISOString(),
                    })
                    models = stamped
                    await writeCache(PROVIDER_ID, stamped)
                    log.info("fetched cohere models", { count: Object.keys(fetched).length })
                } else {
                    const text = await res.text().catch(() => "")
                    log.error("failed to fetch cohere models", { status: res.status, text })
                }
            } catch (e) {
                log.error("cohere model fetch threw", { error: e })
            }
        }

        return {
            autoload: hasKey,
            options: {},
            models: hasKey ? models : {},
        }
    },
}


