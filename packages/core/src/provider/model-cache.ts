import { Global } from "../global"
import { Log } from "../util/log"
import { Provider } from "./provider"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "model-cache" })

/** How long a cached model list is considered fresh (default: 7 days) */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface CacheCatalog {
  providerID: string
  source: "embedded" | "cache" | "fetch" | "stale-cache"
  fetchedAt: string
  ageMs?: number
}

export interface CacheReadOptions {
  ttlMs?: number
  allowExpired?: boolean
}

interface CacheEntry {
  providerID: string
  fetchedAt: string // ISO timestamp
  models: Record<string, Provider.Model>
}

function cacheDir(): string {
  return path.join(Global.Path.cache, "provider-models")
}

function cacheFile(providerID: string): string {
  // Sanitise providerID so it is safe as a file name
  const safe = providerID.replace(/[^a-z0-9_-]/gi, "_")
  return path.join(cacheDir(), `${safe}.json`)
}

/**
 * Read the cached models for a provider.
 * Returns `undefined` if the cache is missing or expired.
 */
export async function readCache(
  providerID: string,
  options: number | CacheReadOptions = DEFAULT_TTL_MS,
): Promise<Record<string, Provider.Model> | undefined> {
  const cached = await readCacheEntry(providerID, options)
  if (!cached) return undefined
  const { entry, ageMs, allowExpired, ttlMs } = cached
  if (ageMs > ttlMs && !allowExpired) {
    log.info("cache expired", { providerID, ageMs })
    return undefined
  }
  log.info(ageMs > ttlMs ? "cache stale" : "cache hit", {
    providerID,
    count: Object.keys(entry.models).length,
    ageMs,
  })
  return entry.models
}

export async function readCacheEntry(
  providerID: string,
  options: number | CacheReadOptions = DEFAULT_TTL_MS,
): Promise<({ entry: CacheEntry; ageMs: number; ttlMs: number; allowExpired: boolean } | undefined)> {
  const ttlMs = typeof options === "number" ? options : options.ttlMs ?? DEFAULT_TTL_MS
  const allowExpired = typeof options === "number" ? false : options.allowExpired ?? false
  try {
    const file = Bun.file(cacheFile(providerID))
    if (!(await file.exists())) return undefined

    const entry = (await file.json()) as CacheEntry
    const age = Date.now() - new Date(entry.fetchedAt).getTime()
    return { entry, ageMs: age, ttlMs, allowExpired }
  } catch (e) {
    log.warn("failed to read cache", { providerID, error: e })
    return undefined
  }
}

/**
 * Persist the fetched models for a provider to the cache.
 */
export async function writeCache(
  providerID: string,
  models: Record<string, Provider.Model>,
): Promise<void> {
  try {
    await fs.mkdir(cacheDir(), { recursive: true })
    const entry: CacheEntry = {
      providerID,
      fetchedAt: new Date().toISOString(),
      models,
    }
    await Bun.write(cacheFile(providerID), JSON.stringify(entry, null, 2))
    log.info("cache written", { providerID, count: Object.keys(models).length })
  } catch (e) {
    log.warn("failed to write cache", { providerID, error: e })
  }
}

export function stampCatalog(
  models: Record<string, Provider.Model>,
  catalog: CacheCatalog,
): Record<string, Provider.Model> {
  return Object.fromEntries(
    Object.entries(models).map(([modelID, model]) => [
      modelID,
      {
        ...model,
        catalog,
      },
    ]),
  )
}

export async function loadCachedModels(
  providerID: string,
  fallbackModels: Record<string, Provider.Model> = {},
): Promise<{
  models: Record<string, Provider.Model>
  cache?: { entry: CacheEntry; ageMs: number; ttlMs: number; allowExpired: boolean }
  stale: boolean
}> {
  const fresh = await readCacheEntry(providerID)
  if (fresh) {
    return {
      models: stampCatalog(fresh.entry.models, {
        providerID,
        source: "cache",
        fetchedAt: fresh.entry.fetchedAt,
        ageMs: fresh.ageMs,
      }),
      cache: fresh,
      stale: false,
    }
  }

  const stale = await readCacheEntry(providerID, { allowExpired: true })
  if (stale) {
    return {
      models: stampCatalog(stale.entry.models, {
        providerID,
        source: "stale-cache",
        fetchedAt: stale.entry.fetchedAt,
        ageMs: stale.ageMs,
      }),
      cache: stale,
      stale: true,
    }
  }

  return {
    models: fallbackModels,
    stale: false,
  }
}

/**
 * Invalidate (delete) the cached models for a provider.
 * Call this when the user connects/updates their API key.
 */
export async function invalidateCache(providerID: string): Promise<void> {
  try {
    await fs.rm(cacheFile(providerID), { force: true })
    log.info("cache invalidated", { providerID })
  } catch (e) {
    log.warn("failed to invalidate cache", { providerID, error: e })
  }
}


