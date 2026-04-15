import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "@/global"

export namespace ProviderDiagnostics {
  export const Entry = z.object({
    scope: z.enum(["models-dev", "provider-refresh"]),
    status: z.enum(["success", "failure", "skipped"]),
    refreshedAt: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative().optional(),
    providerID: z.string().optional(),
    modelCount: z.number().int().nonnegative().optional(),
    reason: z.string().optional(),
    error: z.string().optional(),
    source: z.enum(["cache", "embedded", "fetch", "stale-cache"]).optional(),
  })
  export type Entry = z.infer<typeof Entry>

  export const Summary = z.object({
    scope: z.enum(["models-dev", "provider-refresh"]),
    providerID: z.string().optional(),
    lastRefreshedAt: z.number().int().nonnegative().optional(),
    lastStatus: z.enum(["success", "failure", "skipped"]).optional(),
    refreshCount: z.number().int().nonnegative(),
    successCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    averageDurationMs: z.number().nonnegative(),
    lastDurationMs: z.number().nonnegative().optional(),
    lastModelCount: z.number().int().nonnegative().optional(),
    lastReason: z.string().optional(),
    lastError: z.string().optional(),
    recent: z.array(Entry),
  })
  export type Summary = z.infer<typeof Summary>

  type Store = {
    history: Entry[]
  }

  function file() {
    return path.join(Global.Path.state, "provider-diagnostics.json")
  }

  async function readStore(): Promise<Store> {
    const text = await fs.readFile(file(), "utf8").catch(() => "")
    if (!text.trim()) return { history: [] }
    try {
      const parsed = JSON.parse(text)
      const result = z.object({ history: z.array(Entry).default([]) }).safeParse(parsed)
      return result.success ? result.data : { history: [] }
    } catch {
      return { history: [] }
    }
  }

  async function writeStore(store: Store) {
    await fs.mkdir(path.dirname(file()), { recursive: true })
    await fs.writeFile(file(), JSON.stringify(store, null, 2))
  }

  function normalizeScope(scope: Entry["scope"]) {
    return scope
  }

  export async function record(entry: Entry) {
    const store = await readStore()
    store.history.push(entry)
    store.history = store.history
      .filter(Boolean)
      .sort((a, b) => a.refreshedAt - b.refreshedAt)
      .slice(-250)
    await writeStore(store)
    return entry
  }

  export async function list(filter?: { scope?: Entry["scope"]; providerID?: string }) {
    const store = await readStore()
    return store.history.filter((entry) => {
      if (filter?.scope && normalizeScope(entry.scope) !== normalizeScope(filter.scope)) return false
      if (filter?.providerID && entry.providerID !== filter.providerID) return false
      return true
    })
  }

  export async function latest(filter?: { scope?: Entry["scope"]; providerID?: string }) {
    const entries = await list(filter)
    const sorted = [...entries].sort((a, b) => a.refreshedAt - b.refreshedAt)
    return sorted[sorted.length - 1]
  }

  export async function summarize(filter: { scope: Entry["scope"]; providerID?: string }): Promise<Summary> {
    const entries = [...(await list(filter))].sort((a, b) => a.refreshedAt - b.refreshedAt)
    const last = entries[entries.length - 1]
    const refreshCount = entries.length
    const successCount = entries.filter((entry) => entry.status === "success").length
    const failureCount = entries.filter((entry) => entry.status === "failure").length
    const skippedCount = entries.filter((entry) => entry.status === "skipped").length
    const durations = entries.map((entry) => entry.durationMs).filter((value): value is number => typeof value === "number")
    const averageDurationMs = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0

    return {
      scope: filter.scope,
      providerID: filter.providerID,
      lastRefreshedAt: last?.refreshedAt,
      lastStatus: last?.status,
      refreshCount,
      successCount,
      failureCount,
      skippedCount,
      averageDurationMs,
      lastDurationMs: last?.durationMs,
      lastModelCount: last?.modelCount,
      lastReason: last?.reason,
      lastError: last?.error,
      recent: entries.slice(-5),
    }
  }
}


