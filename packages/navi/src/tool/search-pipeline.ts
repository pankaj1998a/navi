import { Log } from "../util/log"

const log = Log.create({ service: "search-pipeline" })

export type SearchProvider = "browser" | "google" | "bing" | "duckduckgo"

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchExecution {
  provider: SearchProvider | "google-api" | "none"
  attemptedProviders: SearchProvider[]
  results: SearchResult[]
}

const DEFAULT_PROVIDER_ORDER: SearchProvider[] = ["browser", "google", "bing", "duckduckgo"]
const CURRENT_EVENTS_PATTERN =
  /\b(latest|recent|current|today|now|news|update|release|announced|just|trending|this week|this month|this year)\b/i
const DATE_PATTERN =
  /\b(20\d{2}|19\d{2}|last year|yesterday|ago|January|February|March|April|May|June|July|August|September|October|November|December)\b/i

export function normalizeSearchQuery(query: string, now = new Date()): string {
  const trimmed = query.trim()
  if (!trimmed) return trimmed

  if (!CURRENT_EVENTS_PATTERN.test(trimmed) || DATE_PATTERN.test(trimmed)) {
    return trimmed
  }

  const currentYear = now.getFullYear()
  const previousYear = currentYear - 1
  return `${trimmed} ${currentYear} OR ${previousYear}`
}

export function resolveProviderOrder(preferred?: SearchProvider[]): SearchProvider[] {
  if (preferred && preferred.length > 0) {
    return dedupeProviders(preferred)
  }

  const raw = process.env.NAVI_WEB_SEARCH_PROVIDERS
  if (!raw) return [...DEFAULT_PROVIDER_ORDER]

  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
      .filter((item): item is SearchProvider => item === "browser" || item === "google" || item === "bing" || item === "duckduckgo")

  return parsed.length > 0 ? dedupeProviders(parsed) : [...DEFAULT_PROVIDER_ORDER]
}

function dedupeProviders(providers: SearchProvider[]): SearchProvider[] {
  return [...new Set(providers)]
}

export async function executeSearchPipeline(
  query: string,
  numResults: number,
  preferredProviders?: SearchProvider[],
): Promise<SearchExecution> {
  const providerOrder = resolveProviderOrder(preferredProviders)
  const attemptedProviders: SearchProvider[] = []

  for (const provider of providerOrder) {
    attemptedProviders.push(provider)
    try {
      let results: SearchResult[] = []

      if (provider === "browser") {
        const { webSearch } = await import("./browser-engine")
        results = await webSearch(query, numResults)
      } else {
        const { searchWithProvider } = await import("./http-search")
        results = await searchWithProvider(provider, query, numResults)
      }

      if (results.length > 0) {
        return { provider, attemptedProviders, results }
      }
    } catch (error) {
      log.warn("search provider failed", { provider, error: String(error) })
    }
  }

  return { provider: "none", attemptedProviders, results: [] }
}
