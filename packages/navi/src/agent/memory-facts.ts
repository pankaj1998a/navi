import crypto from "crypto"
import z from "zod"
import { MemoryManager } from "./memory-manager"
import { Storage } from "@/storage/storage"
import { SessionCompactionMemory, type CompactionSummary } from "@/session/compaction-memory"

export namespace MemoryFacts {
  export const Source = z.object({
    type: z.enum(["session-compaction", "session-summary", "project-knowledge", "manual"]),
    sessionID: z.string().optional(),
    messageID: z.string().optional(),
    projectID: z.string().optional(),
  })
  export type Source = z.infer<typeof Source>

  export const Fact = z.object({
    kind: z.enum(["objective", "completed", "in-progress", "file", "constraint", "decision", "next-step"]),
    content: z.string(),
    confidence: z.number().min(0).max(1),
    ttlMs: z.number().int().positive().optional(),
  })
  export type Fact = z.infer<typeof Fact>

  export function extractFromCompaction(summary: CompactionSummary): Fact[] {
    const facts: Fact[] = []
    pushFacts(facts, "objective", summary.objective, 0.75)
    pushFacts(facts, "completed", summary.completed, 0.9)
    pushFacts(facts, "in-progress", summary.inProgress, 0.65, 7 * 24 * 60 * 60 * 1000)
    pushFacts(facts, "file", summary.files, 0.95, 14 * 24 * 60 * 60 * 1000)
    pushFacts(facts, "constraint", summary.constraints, 0.85)
    pushFacts(facts, "decision", summary.decisions, 0.9)
    pushFacts(facts, "next-step", summary.nextSteps, 0.7, 7 * 24 * 60 * 60 * 1000)
    return facts
  }

  export async function storeCompactionFacts(input: {
    summary: CompactionSummary
    source: Source
    projectID: string
  }) {
    const facts = extractFromCompaction(input.summary)
    const stored: MemoryManager.MemoryEntry[] = []
    for (const fact of facts) {
      const entry = await storeFact({
        ...fact,
        source: input.source,
        projectID: input.projectID,
      })
      if (entry) stored.push(entry)
    }
    return stored
  }

  export async function storeFact(input: {
    kind: Fact["kind"]
    content: string
    confidence: number
    ttlMs?: number
    source: Source
    projectID: string
  }) {
    const normalized = normalizeContent(input.content)
    const fingerprint = fingerprintOf(normalized)
    const projectTag = `project:${input.projectID}`
    const fingerprintTag = `fingerprint:${fingerprint}`
    const kindTag = `fact:${input.kind}`

    const existing = await MemoryManager.recall({
      tier: "medium",
      tags: [projectTag],
      includeExpired: true,
      limit: 500,
    })
    if (
      existing.some((entry) => {
        if (entry.metadata?.fingerprint === fingerprint) return true
        if (normalizeContent(entry.content) === normalized && entry.metadata?.source?.projectID === input.projectID) return true
        return false
      })
    ) {
      return undefined
    }

    const rendered = renderFact(input.kind, input.content, input.confidence, input.source)
    return await MemoryManager.store(rendered, {
      tier: "medium",
      importance: input.confidence,
      ttlMs: input.ttlMs,
      tags: ["project-fact", projectTag, kindTag, fingerprintTag],
      metadata: {
        kind: input.kind,
        confidence: input.confidence,
        fingerprint,
        projectID: input.projectID,
        source: input.source,
      },
    })
  }

  export async function recallProjectFacts(projectID: string, limit = 6) {
    const entries = await MemoryManager.recall({
      tier: "medium",
      tags: [`project:${projectID}`],
      includeExpired: true,
      limit: 200,
    })
    return entries
      .filter((entry) => entry.tags.includes("project-fact"))
      .sort((a, b) => {
        const confidenceA = (a.metadata?.confidence as number | undefined) ?? a.importance
        const confidenceB = (b.metadata?.confidence as number | undefined) ?? b.importance
        if (confidenceB !== confidenceA) return confidenceB - confidenceA
        return b.lastAccessed - a.lastAccessed
      })
      .slice(0, limit)
  }

  export function renderProjectFacts(entries: MemoryManager.MemoryEntry[]) {
    if (!entries.length) return ""
    return [
      "## Relevant Project Facts",
      ...entries.map((entry) => {
        const confidence = typeof entry.metadata?.confidence === "number" ? entry.metadata.confidence : entry.importance
        const source = entry.metadata?.source
        const sourceText =
          source?.type === "session-compaction"
            ? `session ${source.sessionID ?? "unknown"}`
            : source?.type === "project-knowledge"
              ? "project knowledge"
              : source?.type === "manual"
                ? "manual"
                : "session summary"
        return `- [${Math.round(confidence * 100)}%] ${entry.content} (${sourceText})`
      }),
      "",
    ].join("\n")
  }

  export async function cleanupProjectFacts(projectID: string, options?: { maxPerKind?: number }) {
    const entries = await readMediumEntries()
    const projectEntries = entries.filter((entry) => isProjectFact(entry, projectID))
    if (!projectEntries.length) return { removed: 0, kept: 0 }

    const kept = resolveProjectFacts(projectEntries, options)
    const keepIDs = new Set(kept.map((entry) => entry.id))
    const nextEntries = entries.filter((entry) => !isProjectFact(entry, projectID) || keepIDs.has(entry.id))
    const removed = entries.length - nextEntries.length
    if (removed > 0) {
      await writeMediumEntries(nextEntries)
    }
    return { removed, kept: kept.length }
  }

  export async function cleanupAllProjectFacts(options?: { maxPerKind?: number }) {
    const entries = await readMediumEntries()
    const projectIDs = new Set<string>()
    for (const entry of entries) {
      const projectID = getProjectID(entry)
      if (projectID) projectIDs.add(projectID)
    }

    let removed = 0
    let kept = 0
    for (const projectID of projectIDs) {
      const result = await cleanupProjectFacts(projectID, options)
      removed += result.removed
      kept += result.kept
    }
    return { removed, kept, projectCount: projectIDs.size }
  }

  export function resolveProjectFacts(
    entries: MemoryManager.MemoryEntry[],
    options?: { maxPerKind?: number },
  ) {
    const maxPerKind = options?.maxPerKind ?? 4
    const unique = dedupeByFingerprint(entries)
    const conflictsResolved = pruneConflicts(unique)

    const grouped = new Map<string, MemoryManager.MemoryEntry[]>()
    for (const entry of conflictsResolved) {
      const kind = getFactKind(entry)
      if (!kind) continue
      const list = grouped.get(kind) ?? []
      list.push(entry)
      grouped.set(kind, list)
    }

    const kept: MemoryManager.MemoryEntry[] = []
    for (const list of grouped.values()) {
      list.sort((a, b) => scoreEntry(b) - scoreEntry(a))
      kept.push(...list.slice(0, maxPerKind))
    }

    kept.sort((a, b) => scoreEntry(b) - scoreEntry(a))
    return kept
  }

  function pushFacts(
    facts: Fact[],
    kind: Fact["kind"],
    values: string[],
    confidence: number,
    ttlMs?: number,
  ) {
    for (const value of values) {
      const content = value.trim()
      if (!content) continue
      facts.push({ kind, content, confidence, ttlMs })
    }
  }

  function renderFact(kind: Fact["kind"], content: string, confidence: number, source: Source) {
    const label = kind.replace(/-/g, " ")
    const origin = source.type.replace(/-/g, " ")
    return `${label}: ${content} [confidence ${Math.round(confidence * 100)}%, source: ${origin}]`
  }

  function normalizeContent(text: string) {
    return text.toLowerCase().replace(/\s+/g, " ").trim()
  }

  function normalizeKind(kind: string | undefined) {
    return (kind ?? "").toLowerCase().trim()
  }

  function getFactKind(entry: MemoryManager.MemoryEntry) {
    const kind = entry.metadata?.kind
    if (typeof kind === "string") return kind
    const fromTag = entry.tags.find((tag) => tag.startsWith("fact:"))
    return fromTag ? fromTag.slice("fact:".length) : undefined
  }

  function getProjectID(entry: MemoryManager.MemoryEntry) {
    const fromMetadata = entry.metadata?.projectID
    if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata
    const tag = entry.tags.find((item) => item.startsWith("project:"))
    return tag ? tag.slice("project:".length) : undefined
  }

  function isProjectFact(entry: MemoryManager.MemoryEntry, projectID: string) {
    return entry.tags.includes("project-fact") && getProjectID(entry) === projectID
  }

  function scoreEntry(entry: MemoryManager.MemoryEntry) {
    const confidence = typeof entry.metadata?.confidence === "number" ? entry.metadata.confidence : entry.importance
    return confidence * 1000 + entry.lastAccessed / 1_000_000 + entry.createdAt / 10_000_000
  }

  function dedupeByFingerprint(entries: MemoryManager.MemoryEntry[]) {
    const byFingerprint = new Map<string, MemoryManager.MemoryEntry>()
    for (const entry of [...entries].sort((a, b) => scoreEntry(b) - scoreEntry(a))) {
      const fingerprint = getFingerprint(entry)
      if (!fingerprint) continue
      if (!byFingerprint.has(fingerprint)) {
        byFingerprint.set(fingerprint, entry)
      }
    }
    return [...byFingerprint.values()]
  }

  function getFingerprint(entry: MemoryManager.MemoryEntry) {
    const fingerprint = entry.metadata?.fingerprint
    if (typeof fingerprint === "string" && fingerprint) return fingerprint
    return fingerprintOf(normalizeContent(entry.content))
  }

  function pruneConflicts(entries: MemoryManager.MemoryEntry[]) {
    const removed = new Set<string>()
    const sorted = [...entries].sort((a, b) => scoreEntry(b) - scoreEntry(a))
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]
      if (removed.has(current.id)) continue
      for (let j = i + 1; j < sorted.length; j++) {
        const other = sorted[j]
        if (removed.has(other.id)) continue
        if (!isContradiction(current, other)) continue
        const loser = scoreEntry(current) >= scoreEntry(other) ? other : current
        removed.add(loser.id)
      }
    }
    return sorted.filter((entry) => !removed.has(entry.id))
  }

  function isContradiction(a: MemoryManager.MemoryEntry, b: MemoryManager.MemoryEntry) {
    const kindA = normalizeKind(getFactKind(a))
    const kindB = normalizeKind(getFactKind(b))
    if (!kindA || !kindB || kindA !== kindB) return false

    const textA = normalizeContent(a.content)
    const textB = normalizeContent(b.content)
    if (!textA || !textB || textA === textB) return false

    const baseA = stripPolarityMarkers(textA)
    const baseB = stripPolarityMarkers(textB)
    const overlap = tokenOverlap(baseA, baseB)
    if (overlap < 0.6) return false

    const polarityA = polarity(textA)
    const polarityB = polarity(textB)
    return polarityA !== 0 && polarityB !== 0 && polarityA !== polarityB
  }

  function stripPolarityMarkers(text: string) {
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

  function fingerprintOf(text: string) {
    return crypto.createHash("sha1").update(text).digest("hex").slice(0, 16)
  }

  export function structuredSummaryToFacts(summary: CompactionSummary) {
    return SessionCompactionMemory.render(summary)
  }

  async function readMediumEntries() {
    return await Storage.read<MemoryManager.MemoryEntry[]>(["memory", "medium", "entries"]).catch(() => [])
  }

  async function writeMediumEntries(entries: MemoryManager.MemoryEntry[]) {
    await Storage.write(["memory", "medium", "entries"], entries)
  }
}
