import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "@/global"

export namespace AgentScorecard {
  export const Entry = z.object({
    taskClass: z.string(),
    agentName: z.string(),
    successes: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    totalLatencyMs: z.number().nonnegative(),
    totalCost: z.number().nonnegative(),
    totalToolCalls: z.number().int().nonnegative(),
    totalQuestions: z.number().int().nonnegative(),
    samples: z.number().int().nonnegative(),
    lastRunAt: z.number().optional(),
    lastSuccessAt: z.number().optional(),
    lastFailureAt: z.number().optional(),
  })
  export type Entry = z.infer<typeof Entry>

  export const Summary = z.object({
    taskClass: z.string(),
    agentName: z.string(),
    score: z.number().min(0).max(100),
    successRate: z.number().min(0).max(1),
    avgLatencyMs: z.number().nonnegative(),
    avgCost: z.number().nonnegative(),
    avgToolCalls: z.number().nonnegative(),
    avgQuestions: z.number().nonnegative(),
    samples: z.number().int().nonnegative(),
    lastRunAt: z.number().optional(),
  })
  export type Summary = z.infer<typeof Summary>

  type Store = Record<string, Entry>

  function file() {
    return path.join(Global.Path.state, "agent-scorecards.json")
  }

  function normalize(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, "-")
  }

  function key(taskClass: string, agentName: string) {
    return `${normalize(taskClass)}::${normalize(agentName)}`
  }

  async function readStore(): Promise<Store> {
    const text = await fs.readFile(file(), "utf8").catch(() => "")
    if (!text.trim()) return {}
    try {
      const raw = JSON.parse(text) as unknown
      const parsed = z.record(Entry).safeParse(raw)
      return parsed.success ? parsed.data : {}
    } catch {
      return {}
    }
  }

  async function writeStore(store: Store) {
    await fs.mkdir(path.dirname(file()), { recursive: true })
    await fs.writeFile(file(), JSON.stringify(store, null, 2))
  }

  function defaultSummary(taskClass: string, agentName: string): Summary {
    return {
      taskClass: normalize(taskClass),
      agentName,
      score: 50,
      successRate: 1,
      avgLatencyMs: 0,
      avgCost: 0,
      avgToolCalls: 0,
      avgQuestions: 0,
      samples: 0,
    }
  }

  export function summarize(entry?: Entry): Summary | undefined {
    if (!entry) return undefined
    const successRate = entry.samples ? entry.successes / entry.samples : 1
    const avgLatencyMs = entry.samples ? entry.totalLatencyMs / entry.samples : 0
    const avgCost = entry.samples ? entry.totalCost / entry.samples : 0
    const avgToolCalls = entry.samples ? entry.totalToolCalls / entry.samples : 0
    const avgQuestions = entry.samples ? entry.totalQuestions / entry.samples : 0

    let score = successRate * 100
    if (avgLatencyMs > 0) {
      if (avgLatencyMs > 30000) score -= 20
      else if (avgLatencyMs > 15000) score -= 12
      else if (avgLatencyMs > 5000) score -= 5
    }
    score -= Math.min(avgCost * 1000, 15)
    score -= Math.min(Math.max(avgToolCalls - 5, 0) * 1.5, 10)
    score -= Math.min(Math.max(avgQuestions - 2, 0) * 0.5, 5)
    score = Math.max(0, Math.min(100, score))

    return {
      taskClass: entry.taskClass,
      agentName: entry.agentName,
      score,
      successRate,
      avgLatencyMs,
      avgCost,
      avgToolCalls,
      avgQuestions,
      samples: entry.samples,
      lastRunAt: entry.lastRunAt,
    }
  }

  export async function record(input: {
    taskClass: string
    agentName: string
    success: boolean
    latencyMs: number
    cost: number
    toolCalls: number
    questionCount: number
  }) {
    const store = await readStore()
    const id = key(input.taskClass, input.agentName)
    const current = store[id] ?? {
      taskClass: normalize(input.taskClass),
      agentName: input.agentName,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0,
      totalCost: 0,
      totalToolCalls: 0,
      totalQuestions: 0,
      samples: 0,
    }

    current.samples += 1
    current.totalLatencyMs += Math.max(0, input.latencyMs)
    current.totalCost += Math.max(0, input.cost)
    current.totalToolCalls += Math.max(0, input.toolCalls)
    current.totalQuestions += Math.max(0, input.questionCount)
    current.lastRunAt = Date.now()
    if (input.success) {
      current.successes += 1
      current.lastSuccessAt = Date.now()
    } else {
      current.failures += 1
      current.lastFailureAt = Date.now()
    }

    store[id] = current
    await writeStore(store)
    return summarize(current)
  }

  export async function get(taskClass: string, agentName: string) {
    const store = await readStore()
    return summarize(store[key(taskClass, agentName)])
  }

  export async function list(taskClass?: string) {
    const store = await readStore()
    const summaries = Object.values(store)
      .map((entry) => summarize(entry))
      .filter(Boolean) as Summary[]

    const normalizedTaskClass = taskClass ? normalize(taskClass) : undefined
    return summaries
      .filter((entry) => (normalizedTaskClass ? entry.taskClass === normalizedTaskClass : true))
      .sort((a, b) => {
        if (a.taskClass !== b.taskClass) return a.taskClass.localeCompare(b.taskClass)
        if (b.score !== a.score) return b.score - a.score
        if (b.samples !== a.samples) return b.samples - a.samples
        return a.agentName.localeCompare(b.agentName)
      })
  }

  export async function rankAgentsForTask(taskClass: string, agentNames: string[]) {
    const summaries = await list(taskClass)
    const byAgent = new Map(summaries.map((summary) => [normalize(summary.agentName), summary]))
    return agentNames
      .map((agentName) => byAgent.get(normalize(agentName)) ?? defaultSummary(taskClass, agentName))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (b.samples !== a.samples) return b.samples - a.samples
        return a.agentName.localeCompare(b.agentName)
      })
  }

  export async function recommendAgent(taskClass: string, agentNames: string[]) {
    const ranked = await rankAgentsForTask(taskClass, agentNames)
    return ranked[0]
  }

  export async function reset() {
    await fs.unlink(file()).catch(() => {})
  }
}
