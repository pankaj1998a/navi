/**
//! Navi Agency Agents Registry & NEXUS Multi-Agent Orchestrator
//! Connects 282 specialized AI agent personas across 18 divisions,
//! accelerated with native Rust YAML frontmatter parsing and scoring search.
*/

import fs from "node:fs"
import path from "node:path"
import { native } from "@/memory/native"

export interface AgentMeta {
  id: string
  name: string
  division: string
  description: string
  color: string
  emoji: string
  vibe: string
  file_path: string
}

export interface DivisionInfo {
  id: string
  label: string
  icon: string
  color: string
  agentCount: number
}

export interface SearchResult {
  agent: AgentMeta
  score: number
}

let cachedCatalog: AgentMeta[] | null = null
let cachedCatalogJson: string = "[]"

export function getAgencyRootPath(): string {
  const candidates = [
    path.resolve(__dirname, "../../skills/agency"),
    path.resolve(process.cwd(), "packages/navi/skills/agency"),
    path.resolve(process.cwd(), "skills/agency"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c
    }
  }
  return candidates[0]!
}

function getMarkdownFilesRecursive(dir: string): string[] {
  const result: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        result.push(...getMarkdownFilesRecursive(full))
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        result.push(full)
      }
    }
  } catch {
    // ignore
  }
  return result
}

/**
 * Indexes all agency agents across all 18 divisions.
 * Uses native Rust frontmatter parsing when available.
 */
export function loadAgencyCatalog(forceRefresh = false): AgentMeta[] {
  if (cachedCatalog && !forceRefresh) {
    return cachedCatalog
  }

  const root = getAgencyRootPath()
  if (!fs.existsSync(root)) {
    cachedCatalog = []
    cachedCatalogJson = "[]"
    return []
  }

  const catalog: AgentMeta[] = []
  const divisions = fs.readdirSync(root, { withFileTypes: true })

  for (const div of divisions) {
    if (!div.isDirectory() || div.name === "strategy") continue

    const divPath = path.join(root, div.name)
    const files = getMarkdownFilesRecursive(divPath)

    for (const fullPath of files) {
      const file = path.basename(fullPath)
      const content = fs.readFileSync(fullPath, "utf8")
      const fallbackId = file.replace(/\.md$/, "")

      let meta: AgentMeta | null = null
      if (native.isAvailable && native.parseAgentFrontmatter) {
        meta = native.parseAgentFrontmatter(content, fullPath, fallbackId)
      }

      if (!meta) {
        meta = fallbackParseFrontmatter(content, fullPath, fallbackId, div.name)
      }

      if (meta) {
        meta.division = div.name
        catalog.push(meta)
      }
    }
  }

  catalog.sort((a, b) => a.name.localeCompare(b.name))
  cachedCatalog = catalog
  cachedCatalogJson = JSON.stringify(catalog)
  return catalog
}

function fallbackParseFrontmatter(content: string, filePath: string, fallbackId: string, division: string): AgentMeta {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  let name = fallbackId
  let description = ""
  let color = "cyan"
  let emoji = "🤖"
  let vibe = ""

  if (match && match[1]) {
    for (const line of match[1].split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith("name:")) name = trimmed.replace("name:", "").trim().replace(/^['"]|['"]$/g, "")
      else if (trimmed.startsWith("description:")) description = trimmed.replace("description:", "").trim().replace(/^['"]|['"]$/g, "")
      else if (trimmed.startsWith("color:")) color = trimmed.replace("color:", "").trim().replace(/^['"]|['"]$/g, "")
      else if (trimmed.startsWith("emoji:")) emoji = trimmed.replace("emoji:", "").trim().replace(/^['"]|['"]$/g, "")
      else if (trimmed.startsWith("vibe:")) vibe = trimmed.replace("vibe:", "").trim().replace(/^['"]|['"]$/g, "")
    }
  }

  return {
    id: fallbackId,
    name,
    division,
    description,
    color,
    emoji,
    vibe,
    file_path: filePath,
  }
}

/**
 * Searches agency agents using Rust native scoring or TypeScript fallback.
 */
export function searchAgents(query: string, division?: string, limit = 20): SearchResult[] {
  const catalog = loadAgencyCatalog()
  if (catalog.length === 0) return []

  if (native.isAvailable && native.searchAgencyAgents) {
    const results = native.searchAgencyAgents(cachedCatalogJson, query, division || "", limit)
    if (results && results.length > 0) return results
  }

  // Fallback search
  const q = query.trim().toLowerCase()
  const div = division?.trim().toLowerCase()

  const scored: SearchResult[] = []
  for (const agent of catalog) {
    if (div && agent.division.toLowerCase() !== div) continue

    if (!q) {
      scored.push({ agent, score: 1 })
      continue
    }

    let score = 0
    const nameLower = agent.name.toLowerCase()
    const descLower = agent.description.toLowerCase()
    const idLower = agent.id.toLowerCase()

    if (nameLower === q || idLower === q) score += 100
    else if (nameLower.startsWith(q) || idLower.startsWith(q)) score += 50
    else if (nameLower.includes(q) || idLower.includes(q)) score += 30

    if (descLower.includes(q)) score += 15
    if (agent.vibe.toLowerCase().includes(q)) score += 10

    if (score > 0) {
      scored.push({ agent, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return limit > 0 ? scored.slice(0, limit) : scored
}

/**
 * Finds an agent in the catalog by exact ID, exact Name, stripped division ID suffix, or slugified name.
 */
export function findAgent(query: string): AgentMeta | undefined {
  const catalog = loadAgencyCatalog()
  const q = query.trim().toLowerCase()
  return catalog.find(
    (a) =>
      a.id.toLowerCase() === q ||
      a.name.toLowerCase() === q ||
      a.id.toLowerCase().endsWith("-" + q) ||
      a.name.toLowerCase().replace(/\s+/g, "-") === q,
  )
}

/**
 * Retrieves the full system prompt and instructions of an agency agent by ID.
 * Loaded lazily from disk with zero startup memory overhead.
 */
export function getAgentPrompt(agentId: string): string | null {
  const agent = findAgent(agentId)
  if (!agent || !fs.existsSync(agent.file_path)) {
    return null
  }
  return fs.readFileSync(agent.file_path, "utf8")
}

/**
 * Returns division statistics (counts, icons, brand colors).
 */
export function listDivisions(): DivisionInfo[] {
  const root = getAgencyRootPath()
  const catalog = loadAgencyCatalog()
  const divisionsFile = path.join(root, "divisions.json")

  const counts: Record<string, number> = {}
  for (const a of catalog) {
    counts[a.division] = (counts[a.division] || 0) + 1
  }

  let defs: Record<string, { label: string; icon: string; color: string }> = {}
  if (fs.existsSync(divisionsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(divisionsFile, "utf8"))
      defs = data.divisions || {}
    } catch {
      // ignore
    }
  }

  const result: DivisionInfo[] = []
  for (const [id, count] of Object.entries(counts)) {
    const meta = defs[id] || { label: id.toUpperCase(), icon: "Bot", color: "#6B7280" }
    result.push({
      id,
      label: meta.label,
      icon: meta.icon,
      color: meta.color,
      agentCount: count,
    })
  }

  result.sort((a, b) => b.agentCount - a.agentCount)
  return result
}
