/**
 * Navi Cost Tracker
 *
 * Real-time token usage and cost tracking per session.
 * Shows estimated API costs based on model pricing.
 */

import path from "path"
import { Log } from "../util/log"
import { Global } from "../global"

const log = Log.create({ service: "cost-tracker" })

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type CostRecord = {
  sessionID: string
  model: string
  providerID: string
  usage: TokenUsage
  estimatedCost: number
  timestamp: string
}

export type SessionCostSummary = {
  sessionID: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCost: number
  records: CostRecord[]
  currency: "USD"
}

// In-memory cost records per session
const records = new Map<string, CostRecord[]>()

// ─── Pricing (per 1M tokens in USD) ─────────────────────────────────────────

// Approximate pricing; actual costs depend on provider
const PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }> = {
  // Anthropic
  "claude-opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "o1": { input: 15, output: 60 },
  "o4-mini": { input: 1.1, output: 4.4 },
  // Google
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
}

function getPrice(modelId: string) {
  // Exact match first
  if (PRICING[modelId]) return PRICING[modelId]
  // Fuzzy match
  const lower = modelId.toLowerCase()
  for (const [key, price] of Object.entries(PRICING)) {
    if (lower.includes(key.toLowerCase())) return price
  }
  // Default pricing if unknown
  return { input: 1, output: 5 }
}

function estimateCost(modelId: string, usage: TokenUsage): number {
  const price = getPrice(modelId)
  const inputCost = (usage.inputTokens / 1_000_000) * price.input
  const outputCost = (usage.outputTokens / 1_000_000) * price.output
  const cacheReadCost = ((usage.cacheReadTokens ?? 0) / 1_000_000) * (price.cacheRead ?? price.input * 0.1)
  const cacheWriteCost = ((usage.cacheWriteTokens ?? 0) / 1_000_000) * (price.cacheWrite ?? price.input * 1.25)
  return inputCost + outputCost + cacheReadCost + cacheWriteCost
}

// ─── Public API ───────────────────────────────────────────────────────────────

export namespace CostTracker {
  /**
   * Record token usage for a session.
   */
  export function track(
    sessionID: string,
    model: string,
    providerID: string,
    usage: TokenUsage,
  ): void {
    const estimatedCost = estimateCost(model, usage)
    const record: CostRecord = {
      sessionID,
      model,
      providerID,
      usage,
      estimatedCost,
      timestamp: new Date().toISOString(),
    }

    if (!records.has(sessionID)) {
      records.set(sessionID, [])
    }
    records.get(sessionID)!.push(record)

    log.info("token usage tracked", {
      sessionID,
      model,
      input: usage.inputTokens,
      output: usage.outputTokens,
      cost: estimatedCost.toFixed(6),
    })
  }

  /**
   * Get cost summary for a session.
   */
  export function getSummary(sessionID: string): SessionCostSummary {
    const sessionRecords = records.get(sessionID) ?? []
    return {
      sessionID,
      totalInputTokens: sessionRecords.reduce((s, r) => s + r.usage.inputTokens, 0),
      totalOutputTokens: sessionRecords.reduce((s, r) => s + r.usage.outputTokens, 0),
      totalCacheReadTokens: sessionRecords.reduce((s, r) => s + (r.usage.cacheReadTokens ?? 0), 0),
      totalCacheWriteTokens: sessionRecords.reduce((s, r) => s + (r.usage.cacheWriteTokens ?? 0), 0),
      totalCost: sessionRecords.reduce((s, r) => s + r.estimatedCost, 0),
      records: sessionRecords,
      currency: "USD",
    }
  }

  /**
   * Get total tokens used across all sessions.
   */
  export function getGlobalTotals(): {
    totalSessions: number
    totalTokens: number
    totalCost: number
  } {
    let totalTokens = 0
    let totalCost = 0

    for (const sessionRecords of records.values()) {
      for (const r of sessionRecords) {
        totalTokens += r.usage.inputTokens + r.usage.outputTokens
        totalCost += r.estimatedCost
      }
    }

    return {
      totalSessions: records.size,
      totalTokens,
      totalCost,
    }
  }

  /**
   * Format a session cost summary for display.
   */
  export function format(sessionID: string): string {
    const summary = getSummary(sessionID)
    if (summary.records.length === 0) {
      return "No token usage recorded for this session."
    }

    const formatNum = (n: number) => n.toLocaleString()
    const formatCost = (n: number) => `$${n.toFixed(4)}`

    const lines = [
      `## Session Cost: ${sessionID}`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| Input tokens | ${formatNum(summary.totalInputTokens)} |`,
      `| Output tokens | ${formatNum(summary.totalOutputTokens)} |`,
      ...(summary.totalCacheReadTokens > 0
        ? [`| Cache read tokens | ${formatNum(summary.totalCacheReadTokens)} |`]
        : []),
      ...(summary.totalCacheWriteTokens > 0
        ? [`| Cache write tokens | ${formatNum(summary.totalCacheWriteTokens)} |`]
        : []),
      `| **Estimated cost** | **${formatCost(summary.totalCost)}** |`,
      ``,
      `*Prices are estimates. Actual costs may vary.*`,
    ]

    return lines.join("\n")
  }

  /**
   * Clear cost records for a session.
   */
  export function clear(sessionID: string): void {
    records.delete(sessionID)
  }

  /**
   * Persist session costs to disk for analytics.
   */
  export async function persist(sessionID: string): Promise<void> {
    const summary = getSummary(sessionID)
    if (summary.records.length === 0) return

    const filePath = path.join(Global.Path.state, "costs", `${sessionID}.json`)
    try {
      await Bun.write(filePath, JSON.stringify(summary, null, 2))
    } catch (err) {
      log.error("failed to persist costs", { sessionID, err })
    }
  }
}
