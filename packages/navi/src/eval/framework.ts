import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Config } from "@/config/config"
import { Global } from "@/global"
import {
  BenchmarkCase,
  type BenchmarkCase as BenchmarkCaseInfo,
  DEFAULT_BENCHMARKS,
} from "./catalog"

export namespace EvalFramework {
  export const TurnSample = z
    .object({
      benchmarkID: z.string().optional(),
      taskClass: z.string().optional(),
      sessionID: z.string(),
      step: z.number().int().positive(),
      agent: z.string(),
      requestedModel: z.string(),
      routedModel: z.string(),
      toolCalls: z.number().int().nonnegative(),
      questionCount: z.number().int().nonnegative(),
      cost: z.number().nonnegative(),
      finish: z.string().optional(),
      error: z.string().optional(),
      policy: z.record(z.string(), z.any()).optional(),
      routingReasons: z.array(z.string()).optional(),
      responseKind: z.string().optional(),
      responseConfidence: z.number().min(0).max(1).optional(),
      responseSources: z.array(z.string()).optional(),
      responseNextStep: z.string().optional(),
      responseBlockedReason: z.string().optional(),
      responseHandoff: z
        .object({
          summary: z.string(),
          nextAgent: z.string().optional(),
          openQuestions: z.array(z.string()).optional(),
          files: z.array(z.string()).optional(),
          notes: z.string().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "EvalTurnSample",
    })
  export type TurnSample = z.infer<typeof TurnSample>

  async function filepath() {
    const config = await Config.get()
    const dir = config.experimental?.evaluation?.directory
      ? path.resolve(config.experimental.evaluation.directory)
      : path.join(Global.Path.state, "eval")
    await fs.mkdir(dir, { recursive: true })
    return path.join(dir, "turns.jsonl")
  }

  export async function recordTurn(sample: TurnSample) {
    const config = await Config.get()
    if (config.experimental?.evaluation?.enabled === false) return
    const file = await filepath()
    await fs.appendFile(file, JSON.stringify(sample) + "\n")
  }

  export function benchmarks(): BenchmarkCaseInfo[] {
    return DEFAULT_BENCHMARKS
  }

  export async function readTurns(): Promise<TurnSample[]> {
    const file = await filepath()
    const text = await fs.readFile(file, "utf8").catch(() => "")
    if (!text.trim()) return []

    const parsed: TurnSample[] = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        parsed.push(TurnSample.parse(JSON.parse(line)))
      } catch {
        continue
      }
    }
    return parsed
  }

  export function summarizeTurns(
    turns: TurnSample[],
    filter?: {
      agent?: string
      benchmarkID?: string
      taskClass?: string
    },
  ) {
    const filtered = turns.filter((turn) => {
      if (filter?.agent && turn.agent !== filter.agent) return false
      if (filter?.benchmarkID && turn.benchmarkID !== filter.benchmarkID) return false
      if (filter?.taskClass && turn.taskClass !== filter.taskClass) return false
      return true
    })

    const completed = filtered.filter((turn) => !turn.error)
    const failed = filtered.filter((turn) => !!turn.error)
    const totalCost = filtered.reduce((sum, turn) => sum + turn.cost, 0)
    const totalTools = filtered.reduce((sum, turn) => sum + turn.toolCalls, 0)
    const totalQuestions = filtered.reduce((sum, turn) => sum + turn.questionCount, 0)
    const interruptionRate = filtered.length ? totalQuestions / filtered.length : 0
    let score = filtered.length ? (completed.length / filtered.length) * 100 : 0
    score -= Math.min(totalCost * 1000, 25)
    score -= Math.min(totalTools * 1.25, 15)
    score -= Math.min(interruptionRate * 4, 10)
    score = Math.max(0, Math.min(100, score))

    return {
      count: filtered.length,
      completed: completed.length,
      failed: failed.length,
      passRate: filtered.length ? completed.length / filtered.length : 0,
      score,
      totalCost,
      avgCost: filtered.length ? totalCost / filtered.length : 0,
      avgToolCalls: filtered.length ? totalTools / filtered.length : 0,
      avgQuestions: filtered.length ? totalQuestions / filtered.length : 0,
    }
  }
}

