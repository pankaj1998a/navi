import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "@/global"

export namespace ResearchLedger {
  export type StopDecision = {
    stop: boolean
    reason: string
    recentConfidence: number
    recentImprovement: number
    newSources: number
    contradictions: number
    samples: number
  }
  export const Entry = z.object({
    sessionID: z.string(),
    taskClass: z.string(),
    agent: z.string(),
    summary: z.string(),
    sources: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1).optional(),
    kind: z.string().optional(),
    nextStep: z.string().optional(),
    blockedReason: z.string().optional(),
    createdAt: z.number().int().nonnegative(),
  })
  export type Entry = z.infer<typeof Entry>

  function file(sessionID: string) {
    return path.join(Global.Path.state, "research", `${sessionID}.json`)
  }

  async function readEntries(sessionID: string) {
    const text = await fs.readFile(file(sessionID), "utf8").catch(() => "")
    if (!text.trim()) return [] as Entry[]
    try {
      const parsed = JSON.parse(text)
      const result = z.array(Entry).safeParse(parsed)
      return result.success ? result.data : []
    } catch {
      return []
    }
  }

  async function writeEntries(sessionID: string, entries: Entry[]) {
    await fs.mkdir(path.dirname(file(sessionID)), { recursive: true })
    await fs.writeFile(file(sessionID), JSON.stringify(entries.slice(-200), null, 2))
  }

  export async function recordTurn(input: {
    sessionID: string
    taskClass: string
    agent: string
    summary: string
    sources: string[]
    confidence?: number
    kind?: string
    nextStep?: string
    blockedReason?: string
  }) {
    const summary = input.summary.trim()
    if (!summary && !input.sources.length) return
    const entries = await readEntries(input.sessionID)
    entries.push({
      sessionID: input.sessionID,
      taskClass: input.taskClass,
      agent: input.agent,
      summary,
      sources: input.sources.filter(Boolean),
      confidence: input.confidence,
      kind: input.kind,
      nextStep: input.nextStep,
      blockedReason: input.blockedReason,
      createdAt: Date.now(),
    })
    await writeEntries(input.sessionID, entries)
  }

  export async function list(sessionID: string) {
    return await readEntries(sessionID)
  }

  export async function summarize(sessionID: string) {
    const entries = await readEntries(sessionID)
    if (!entries.length) return ""
    const ranked = rankEntries(entries)
    const contradictions = detectContradictions(ranked)
    const stop = evaluateStop(entries, contradictions.length)
    const confidence = ranked.length
      ? ranked.reduce((sum, entry) => sum + (entry.confidence ?? 0.5), 0) / ranked.length
      : 0
    const plan = inferResearchPlan(ranked)
    return [
      "## Research Plan",
      `- ${plan}`,
      "",
      "## Research Evidence",
      ...ranked.slice(0, 8).map((entry) => {
        const sourceText = entry.sources.length ? entry.sources.slice(0, 3).join(", ") : "no explicit sources"
        const score = Math.round((entry.confidence ?? 0.5) * 100)
        return `- [${score}%] ${entry.summary} (${sourceText})`
      }),
      "",
      "## Research Confidence",
      `- Overall confidence: ${Math.round(confidence * 100)}%`,
      "",
      "## Stopping Criteria",
      `- ${stop.stop ? "Stop" : "Continue"}: ${stop.reason}`,
      `- Recent confidence: ${Math.round(stop.recentConfidence * 100)}%`,
      `- Recent improvement: ${Math.round(stop.recentImprovement * 100)}%`,
      `- New sources (recent): ${stop.newSources}`,
      ...(contradictions.length
        ? [
            "## Contradictions",
            ...contradictions.map((item) => `- ${item}`),
          ]
        : []),
      "",
    ]
      .filter((line): line is string => typeof line === "string" && line.length > 0)
      .join("\n")
  }

  export async function stoppingCriteria(sessionID: string): Promise<StopDecision> {
    const entries = await readEntries(sessionID)
    const contradictions = detectContradictions(rankEntries(entries))
    return evaluateStop(entries, contradictions.length)
  }

  function rankEntries(entries: Entry[]) {
    return [...entries].sort((a, b) => {
      const confidenceA = a.confidence ?? 0.5
      const confidenceB = b.confidence ?? 0.5
      if (confidenceB !== confidenceA) return confidenceB - confidenceA
      const sourceCountA = a.sources.length
      const sourceCountB = b.sources.length
      if (sourceCountB !== sourceCountA) return sourceCountB - sourceCountA
      return b.createdAt - a.createdAt
    })
  }

  function inferResearchPlan(entries: Entry[]) {
    const sources = entries.flatMap((entry) => entry.sources)
    const hasWeb = sources.some((source) => /^https?:\/\//i.test(source))
    const hasLocal = sources.some((source) =>
      /^[a-z]:[\\/]/i.test(source) || source.startsWith("./") || source.startsWith("../") || source.includes("packages/") || source.includes("src/"),
    )

    if (hasLocal && hasWeb) return "Mixed research path: confirm local codebase facts first, then verify external claims with web sources."
    if (hasLocal) return "Local codebase path: inspect source, symbols, tests, and history before reaching for web sources."
    if (hasWeb) return "Web research path: prioritize authoritative sources, then cross-check contradictions and freshness."
    return "Research path undecided: pick the smallest evidence source that can answer the current uncertainty."
  }

  function detectContradictions(entries: Entry[]) {
    const contradictions: string[] = []
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]
        const b = entries[j]
        if (!looksContradictory(a.summary, b.summary)) continue
        contradictions.push(`${a.summary} <> ${b.summary}`)
      }
    }
    return contradictions.slice(0, 5)
  }

  function looksContradictory(a: string, b: string) {
    const left = normalize(a)
    const right = normalize(b)
    if (!left || !right || left === right) return false
    const overlap = tokenOverlap(stripPolarity(left), stripPolarity(right))
    if (overlap < 0.55) return false
    return polarity(left) !== 0 && polarity(right) !== 0 && polarity(left) !== polarity(right)
  }

  function normalize(text: string) {
    return text.toLowerCase().replace(/\s+/g, " ").trim()
  }

  function stripPolarity(text: string) {
    return text
      .replace(/\b(do not|don't|never|avoid|disable|deny|exclude|remove|forget|skip|without|must not|should not)\b/g, " ")
      .replace(/\b(allow|enable|use|prefer|keep|include|retain|store|save|must|should|need|require)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  function polarity(text: string) {
    if (/\b(do not|don't|never|avoid|disable|deny|exclude|remove|forget|skip|without|must not|should not)\b/.test(text)) return -1
    if (/\b(allow|enable|use|prefer|keep|include|retain|store|save|must|should|need|require)\b/.test(text)) return 1
    return 0
  }

  function tokenOverlap(a: string, b: string) {
    const wordsA = new Set(a.split(/\s+/).filter(Boolean))
    const wordsB = new Set(b.split(/\s+/).filter(Boolean))
    if (!wordsA.size || !wordsB.size) return 0
    let overlap = 0
    for (const word of wordsA) {
      if (wordsB.has(word)) overlap++
    }
    return overlap / Math.max(wordsA.size, wordsB.size)
  }

  function evaluateStop(entries: Entry[], contradictionCount: number): StopDecision {
    const samples = entries.length
    if (samples < 3) {
      return {
        stop: false,
        reason: "insufficient evidence yet (need at least 3 entries)",
        recentConfidence: averageConfidence(entries),
        recentImprovement: 0,
        newSources: countNewSources(entries),
        contradictions: contradictionCount,
        samples,
      }
    }

    const recent = entries.slice(-3)
    const previous = entries.slice(-6, -3)
    const recentConfidence = averageConfidence(recent)
    const previousConfidence = previous.length ? averageConfidence(previous) : recentConfidence
    const recentImprovement = recentConfidence - previousConfidence
    const newSources = countNewSources(entries)

    if (recentConfidence >= 0.85 && contradictionCount === 0) {
      return {
        stop: true,
        reason: "high confidence with no contradictions",
        recentConfidence,
        recentImprovement,
        newSources,
        contradictions: contradictionCount,
        samples,
      }
    }

    if (newSources === 0 && Math.abs(recentImprovement) < 0.05) {
      return {
        stop: true,
        reason: "no new sources and no meaningful confidence gain across the last 3 entries",
        recentConfidence,
        recentImprovement,
        newSources,
        contradictions: contradictionCount,
        samples,
      }
    }

    if (samples >= 8 && Math.abs(recentImprovement) < 0.03 && contradictionCount <= 1) {
      return {
        stop: true,
        reason: "diminishing returns after 8+ entries with minimal improvement",
        recentConfidence,
        recentImprovement,
        newSources,
        contradictions: contradictionCount,
        samples,
      }
    }

    return {
      stop: false,
      reason: "evidence still changing or contradictions remain",
      recentConfidence,
      recentImprovement,
      newSources,
      contradictions: contradictionCount,
      samples,
    }
  }

  function averageConfidence(entries: Entry[]) {
    if (!entries.length) return 0
    return entries.reduce((sum, entry) => sum + (entry.confidence ?? 0.5), 0) / entries.length
  }

  function countNewSources(entries: Entry[]) {
    if (entries.length <= 3) return 0
    const recent = entries.slice(-3)
    const earlier = entries.slice(0, -3)
    const earlierSources = new Set(earlier.flatMap((entry) => entry.sources))
    const recentSources = new Set(recent.flatMap((entry) => entry.sources))
    let count = 0
    for (const source of recentSources) {
      if (source && !earlierSources.has(source)) count++
    }
    return count
  }
}
