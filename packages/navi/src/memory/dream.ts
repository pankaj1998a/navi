import * as fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import { Log } from "@navi-ai/core/util/log"

const log = Log.create({ service: "memory.dream" })

export interface ObservationRecord {
  id: string
  file: string
  topic: string
  created: string
  text: string
}

export interface DreamResult {
  consolidated: number
  topics: string[]
  summaryPath: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

export function parseObservation(file: string, content: string): ObservationRecord {
  const match = content.match(FRONTMATTER_RE)
  let topic = "general"
  let created = new Date().toISOString()
  let text = content.trim()

  if (match) {
    const frontmatter = match[1] || ""
    text = (match[2] || "").trim()

    const topicMatch = frontmatter.match(/^topic:\s*(.+)$/m)
    if (topicMatch && topicMatch[1]) topic = topicMatch[1].trim()

    const createdMatch = frontmatter.match(/^created:\s*(.+)$/m)
    if (createdMatch && createdMatch[1]) created = createdMatch[1].trim()
  }

  const id = path.basename(file, ".md")
  return { id, file, topic, created, text }
}

export async function consolidateInbox(options: {
  scopeDir: string
}): Promise<DreamResult> {
  const { scopeDir } = options
  const inboxDir = path.join(scopeDir, "observations", "_inbox")
  const archiveDir = path.join(scopeDir, "observations", "archive")
  const topicsDir = path.join(scopeDir, "topics")
  const memoryFile = path.join(scopeDir, "MEMORY.md")

  await fs.mkdir(inboxDir, { recursive: true })
  await fs.mkdir(archiveDir, { recursive: true })
  await fs.mkdir(topicsDir, { recursive: true })

  const entries = await fs.readdir(inboxDir, { withFileTypes: true }).catch(() => [])
  const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => path.join(inboxDir, e.name))

  if (mdFiles.length === 0) {
    return { consolidated: 0, topics: [], summaryPath: memoryFile }
  }

  const observations: ObservationRecord[] = []
  for (const file of mdFiles) {
    try {
      const content = await fs.readFile(file, "utf8")
      observations.push(parseObservation(file, content))
    } catch (err) {
      log.warn("failed to read observation file", { file, error: String(err) })
    }
  }

  // Group by topic
  const byTopic = new Map<string, ObservationRecord[]>()
  for (const obs of observations) {
    const key = obs.topic.toLowerCase().replace(/[^a-z0-9_-]/g, "_")
    const list = byTopic.get(key) ?? []
    list.push(obs)
    byTopic.set(key, list)
  }

  const updatedTopics: string[] = []

  // Consolidate into topics/<topic>.md
  for (const [topicKey, items] of byTopic.entries()) {
    const topicPath = path.join(topicsDir, `${topicKey}.md`)
    let existingContent = ""
    try {
      existingContent = await fs.readFile(topicPath, "utf8")
    } catch {
      existingContent = `# Topic: ${topicKey}\n\n`
    }

    const lines: string[] = [existingContent.trim(), "", `## Consolidated on ${new Date().toISOString().slice(0, 10)}`]
    for (const item of items) {
      lines.push(`- [${item.created.slice(0, 16)}] ${item.text.replace(/\n+/g, " ")}`)
    }
    lines.push("")

    await fs.writeFile(topicPath, lines.join("\n"), "utf8")
    updatedTopics.push(topicKey)
  }

  // Update or regenerate MEMORY.md overview
  const allTopicFiles = (await fs.readdir(topicsDir).catch(() => []))
    .filter((f) => f.endsWith(".md"))

  const memoryOverviewLines: string[] = [
    `# Global & Workspace Memory Index`,
    ``,
    `*Last consolidated (dream): ${new Date().toISOString()}*`,
    ``,
    `### Active Topics`,
  ]

  for (const tf of allTopicFiles) {
    const topicName = path.basename(tf, ".md")
    memoryOverviewLines.push(`- **[${topicName}](topics/${tf})**`)
  }

  memoryOverviewLines.push(
    ``,
    `### Recent Insights`,
  )
  for (const obs of observations.slice(-10)) {
    memoryOverviewLines.push(`- *(${obs.topic})*: ${obs.text.slice(0, 180).replace(/\n+/g, " ")}${obs.text.length > 180 ? "..." : ""}`)
  }
  memoryOverviewLines.push("")

  await fs.writeFile(memoryFile, memoryOverviewLines.join("\n"), "utf8")

  // Archive processed inbox files
  for (const obs of observations) {
    const dest = path.join(archiveDir, path.basename(obs.file))
    await fs.rename(obs.file, dest).catch(() => fs.unlink(obs.file).catch(() => {}))
  }

  log.info("dream consolidation completed", {
    consolidated: observations.length,
    topics: updatedTopics,
  })

  return {
    consolidated: observations.length,
    topics: updatedTopics,
    summaryPath: memoryFile,
  }
}

/**
 * Maximal Marginal Relevance (MMR) Jaccard diversity re-ranking (ported from xAI Grok-Build mmr.rs).
 * Penalizes candidates with high token overlap against already selected top hits.
 */
export function jaccardSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().split(/\W+/).filter((w) => w.length > 2))
  const wordsB = new Set(textB.toLowerCase().split(/\W+/).filter((w) => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let common = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) common++
  }
  const union = wordsA.size + wordsB.size - common
  return union === 0 ? 0 : common / union
}

export function applyMmrReranking<T extends { snippet: string; score: number }>(
  items: T[],
  limit: number,
  diversityThreshold = 0.65,
): T[] {
  if (items.length <= 1) return items
  const selected: T[] = [items[0]!]

  for (let i = 1; i < items.length && selected.length < limit; i++) {
    const candidate = items[i]!
    const tooSimilar = selected.some(
      (sel) => jaccardSimilarity(sel.snippet, candidate.snippet) > diversityThreshold,
    )
    if (!tooSimilar) {
      selected.push(candidate)
    }
  }

  return selected
}
