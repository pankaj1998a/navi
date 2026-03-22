/**
 * Generic helpers for fetching model lists from OpenAI-compatible /models endpoints.
 *
 * Most commercial LLM providers expose `GET /v1/models` which returns the standard
 * OpenAI list format:
 *   { data: [{ id, created, object, owned_by, ... }] }
 *
 * Some providers extend the schema with pricing, context windows, etc.
 * This module handles the baseline case and lets each provider supply a
 * transform function when the schema diverges.
 */

import { Provider } from "./provider"
import { Log } from "../util/log"
import { Installation } from "../installation"

const log = Log.create({ service: "fetch-models" })

export interface FetchModelsOptions {
    /** Provider id – used for logging only */
    providerID: string
    /** Full URL to the /models endpoint */
    url: string
    /** Bearer token, or undefined for unauthenticated requests */
    apiKey?: string
    /** Extra headers to send */
    headers?: Record<string, string>
    /** API base URL written into each model's api.url */
    baseURL: string
    /** npm package used to call this provider */
    npm: string
    /** Optional transform applied to each raw model object from the API */
    transform?: (raw: any) => Partial<Provider.Model> | undefined
}

/** Standard OpenAI list-models response shape (simplified) */
interface OpenAIModel {
    id: string
    created?: number
    object?: string
    owned_by?: string
}

/**
 * Merge base defaults with provider-specific overrides coming from `transform`.
 */
function buildModel(
    raw: OpenAIModel,
    providerID: string,
    baseURL: string,
    npm: string,
    extra: Partial<Provider.Model> = {},
): Provider.Model {
    const base: Provider.Model = {
        id: raw.id,
        providerID,
        name: (raw as any).name ?? raw.id,
        api: {
            id: raw.id,
            url: baseURL,
            npm,
        },
        status: "active",
        capabilities: {
            temperature: true,
            reasoning: false,
            attachment: false,
            toolcall: true,
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
            interleaved: false,
        },
        cost: {
            input: 0,
            output: 0,
            cache: { read: 0, write: 0 },
        },
        limit: { context: 0, output: 0 },
        options: {},
        headers: {},
        release_date:
            raw.created ? new Date(raw.created * 1000).toISOString() : new Date().toISOString(),
        isFree: false,
        variants: {},
    }

    return { ...base, ...extra } as Provider.Model
}

/**
 * Fetch models from an OpenAI-compatible `/models` endpoint.
 *
 * Returns `undefined` when the request fails (so the caller can fall back to
 * cached or hardcoded data).
 */
export async function fetchOpenAICompatibleModels(
    opts: FetchModelsOptions,
): Promise<Record<string, Provider.Model> | undefined> {
    try {
        const { providerID, url, apiKey, headers: extraHeaders, baseURL, npm, transform } = opts

        const headers: Record<string, string> = {
            "User-Agent": Installation.USER_AGENT,
            Accept: "application/json",
            ...extraHeaders,
        }
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

        log.info("fetching models", { providerID, url })
        const res = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(10_000),
        })

        if (!res.ok) {
            const text = await res.text().catch(() => "")
            log.error("failed to fetch models", { providerID, status: res.status, text })
            return undefined
        }

        const data: any = await res.json()

        // Handle both { data: [...] } and plain [ ... ] responses
        const rawList: any[] = Array.isArray(data) ? data : (data?.data ?? [])

        if (!Array.isArray(rawList) || rawList.length === 0) {
            log.warn("empty model list", { providerID })
            return undefined
        }

        const models: Record<string, Provider.Model> = {}
        for (const raw of rawList) {
            if (typeof raw.id !== "string") continue
            const extra = transform ? transform(raw) : {}
            if (extra === undefined) continue   // allow transform to skip a model
            models[raw.id] = buildModel(raw, providerID, baseURL, npm, extra ?? {})
        }

        log.info("fetched models", { providerID, count: Object.keys(models).length })
        return models
    } catch (e) {
        log.error("fetch error", { providerID: opts.providerID, error: e })
        return undefined
    }
}
