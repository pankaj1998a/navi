import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "@/global"

export namespace ProviderReliability {
  export const Entry = z.object({
    providerID: z.string(),
    modelID: z.string(),
    successes: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    totalLatencyMs: z.number().nonnegative(),
    totalCost: z.number().nonnegative().default(0),
    samples: z.number().int().nonnegative(),
    lastSuccessAt: z.number().optional(),
    lastFailureAt: z.number().optional(),
  })
  export type Entry = z.infer<typeof Entry>

  export const Summary = z.object({
    providerID: z.string(),
    modelID: z.string(),
    score: z.number().min(0).max(100),
    successRate: z.number().min(0).max(1),
    avgLatencyMs: z.number().nonnegative(),
    avgCost: z.number().nonnegative(),
    samples: z.number().int().nonnegative(),
  })
  export type Summary = z.infer<typeof Summary>

  type Store = Record<string, Entry>

  function file() {
    return path.join(Global.Path.state, "provider-reliability.json")
  }

  function key(providerID: string, modelID: string) {
    return `${providerID}/${modelID}`
  }

  async function readStore(): Promise<Store> {
    const text = await fs.readFile(file(), "utf8").catch(() => "")
    if (!text.trim()) return {}
    try {
      const raw = JSON.parse(text) as Store
      return raw
    } catch {
      return {}
    }
  }

  async function writeStore(store: Store) {
    await fs.mkdir(path.dirname(file()), { recursive: true })
    await fs.writeFile(file(), JSON.stringify(store, null, 2))
  }

  export async function record(input: {
    providerID: string
    modelID: string
    success: boolean
    latencyMs: number
    cost?: number
  }) {
    const store = await readStore()
    const id = key(input.providerID, input.modelID)
    const current = store[id] ?? {
      providerID: input.providerID,
      modelID: input.modelID,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      totalCost: 0,
      samples: 0,
    }

    current.samples += 1
    current.totalLatencyMs += Math.max(0, input.latencyMs)
    current.totalCost += Math.max(0, input.cost ?? 0)
    if (input.success) {
      current.successes += 1
      current.lastSuccessAt = Date.now()
    } else {
      current.failures += 1
      current.lastFailureAt = Date.now()
    }
    store[id] = current
    await writeStore(store)
  }

  export function summarize(entry?: Entry): Summary | undefined {
    if (!entry) return undefined
    const successRate = entry.samples ? entry.successes / entry.samples : 1
    const avgLatencyMs = entry.samples ? entry.totalLatencyMs / entry.samples : 0
    const avgCost = entry.samples ? entry.totalCost / entry.samples : 0
    let score = successRate * 100

    if (avgLatencyMs > 0) {
      if (avgLatencyMs > 30000) score -= 25
      else if (avgLatencyMs > 15000) score -= 15
      else if (avgLatencyMs > 5000) score -= 5
    }

    if (avgCost > 0) {
      score -= Math.min(avgCost * 1000, 15)
    }

    score = Math.max(0, Math.min(100, score))
    return {
      providerID: entry.providerID,
      modelID: entry.modelID,
      score,
      successRate,
      avgLatencyMs,
      avgCost,
      samples: entry.samples,
    }
  }

  export async function get(providerID: string, modelID: string) {
    const store = await readStore()
    return summarize(store[key(providerID, modelID)])
  }

  export async function list() {
    const store = await readStore()
    return Object.values(store)
      .map((entry) => summarize(entry))
      .filter(Boolean) as Summary[]
  }
}


