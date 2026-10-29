/**
 * Structured Git/File-Backed Wiki Store
 * Modeled after ai-memory's wiki architecture:
 * - Plain Markdown as the source of truth
 * - Namespaces: sessions/, concepts/, decisions/, gotchas/, _rules/, procedures/
 * - Tiered temporal decay curves (semantic, procedural, episodic)
 * - Access-weighted retention & feedback reinforcement
 * - Linting & contradiction detection
 */

import fs from "node:fs"
import path from "node:path"
// @ts-ignore
import yaml from "js-yaml"
import { Global } from "@navi-ai/core/global"
import { Database } from "@/storage/db"
import { sanitizeText } from "./sanitize"

export type WikiTier = "episodic" | "semantic" | "procedural"
export type WikiKind = "fact" | "decision" | "gotcha" | "rule" | "procedure"
export type WikiConfidence = "provisional" | "high" | "confirmed"

export interface WikiFrontmatter {
  title: string
  tier: WikiTier
  kind: WikiKind
  scope?: "global" | "projects" | "sessions"
  scope_id?: string
  tags?: string[]
  pinned?: boolean
  created_at?: string
  updated_at?: string
  expires_at?: string
  confidence?: WikiConfidence
  session_id?: string
  retention_weight?: number
  access_count?: number
}

export interface WikiPageMeta extends WikiFrontmatter {
  path: string
  fullPath: string
  content: string
  body: string
  decayScore: number
}

export interface WriteWikiPageInput {
  path: string
  content: string
  title?: string
  tier?: WikiTier
  kind?: WikiKind
  scope?: "global" | "projects" | "sessions"
  scope_id?: string
  tags?: string[]
  pinned?: boolean
  expires_at?: string
  confidence?: WikiConfidence
  session_id?: string
}

const TIER_HALF_LIFE_DAYS: Record<WikiTier, number> = {
  episodic: 7,
  semantic: 60,
  procedural: 90,
}

export function getWikiRoot(): string {
  const root = path.join(Global.Path.data, "memory", "wiki")
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true })
  }
  return root
}

export function inferTierAndKind(relPath: string): { tier: WikiTier; kind: WikiKind } {
  const normalized = relPath.replace(/\\/g, "/").toLowerCase()
  if (normalized.startsWith("sessions/")) {
    return { tier: "episodic", kind: "fact" }
  }
  if (normalized.startsWith("decisions/")) {
    return { tier: "semantic", kind: "decision" }
  }
  if (normalized.startsWith("gotchas/")) {
    return { tier: "semantic", kind: "gotcha" }
  }
  if (normalized.startsWith("_rules/")) {
    return { tier: "procedural", kind: "rule" }
  }
  if (normalized.startsWith("procedures/")) {
    return { tier: "procedural", kind: "procedure" }
  }
  return { tier: "semantic", kind: "fact" }
}

export function parseFrontmatter(rawContent: string): { frontmatter: Partial<WikiFrontmatter>; body: string } {
  const trimmed = rawContent.trimStart()
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: rawContent }
  }
  const endIdx = trimmed.indexOf("\n---", 3)
  if (endIdx === -1) {
    return { frontmatter: {}, body: rawContent }
  }

  const yamlStr = trimmed.slice(3, endIdx).trim()
  const body = trimmed.slice(endIdx + 4).trimStart()

  try {
    const parsed = yaml.load(yamlStr) as Record<string, unknown>
    return { frontmatter: (parsed || {}) as Partial<WikiFrontmatter>, body }
  } catch {
    return { frontmatter: {}, body: rawContent }
  }
}

export function calculateDecayScore(frontmatter: Partial<WikiFrontmatter>, nowMs: number = Date.now()): number {
  if (frontmatter.pinned) return 1.0

  const tier = frontmatter.tier || "semantic"
  const halfLifeDays = TIER_HALF_LIFE_DAYS[tier] || 30
  const createdMs = frontmatter.created_at ? new Date(frontmatter.created_at).getTime() : nowMs
  const ageDays = Math.max(0, (nowMs - createdMs) / (1000 * 3600 * 24))

  // Access count and retention weight slow decay down
  const accessBoost = 1.0 + Math.log1p(frontmatter.access_count || 0) * 0.5
  const retentionWeight = frontmatter.retention_weight || 1.0

  const effectiveHalfLife = halfLifeDays * accessBoost * retentionWeight
  return Math.exp((-Math.LN2 * ageDays) / effectiveHalfLife)
}

export function writeWikiPage(input: WriteWikiPageInput): WikiPageMeta {
  const root = getWikiRoot()
  const cleanPath = input.path.replace(/\\/g, "/").replace(/^\/+/, "")
  const fullPath = path.join(root, cleanPath)

  fs.mkdirSync(path.dirname(fullPath), { recursive: true })

  const { tier, kind } = inferTierAndKind(cleanPath)
  const existingMeta = fs.existsSync(fullPath) ? readWikiPage(cleanPath) : null

  const rawTitle = input.title || existingMeta?.title || path.basename(cleanPath, path.extname(cleanPath)).replace(/[-_]/g, " ")
  const title = sanitizeText(rawTitle)

  const fm: WikiFrontmatter = {
    title,
    tier: input.tier || existingMeta?.tier || tier,
    kind: input.kind || existingMeta?.kind || kind,
    scope: input.scope || existingMeta?.scope || "projects",
    scope_id: input.scope_id || existingMeta?.scope_id,
    tags: (input.tags || existingMeta?.tags || []).map((t) => sanitizeText(t)),
    pinned: input.pinned !== undefined ? input.pinned : existingMeta?.pinned || false,
    created_at: existingMeta?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: input.expires_at || existingMeta?.expires_at,
    confidence: input.confidence || existingMeta?.confidence || "high",
    session_id: input.session_id || existingMeta?.session_id,
    retention_weight: existingMeta?.retention_weight || 1.0,
    access_count: existingMeta?.access_count || 0,
  }

  // Strip existing frontmatter from content if caller passed it
  const { body } = parseFrontmatter(input.content)
  const sanitizedBody = sanitizeText(body.trim())
  const serializedYaml = yaml.dump(fm).trim()
  const fullContent = `---\n${serializedYaml}\n---\n\n# ${fm.title}\n\n${sanitizedBody}\n`

  fs.writeFileSync(fullPath, fullContent, "utf-8")

  return {
    ...fm,
    path: cleanPath,
    fullPath,
    content: fullContent,
    body,
    decayScore: calculateDecayScore(fm),
  }
}

export function readWikiPage(relPath: string, recordAccess = true): WikiPageMeta | null {
  const root = getWikiRoot()
  const cleanPath = relPath.replace(/\\/g, "/").replace(/^\/+/, "")
  const fullPath = path.join(root, cleanPath)

  if (!fs.existsSync(fullPath)) return null

  const content = fs.readFileSync(fullPath, "utf-8")
  const { frontmatter, body } = parseFrontmatter(content)
  const { tier, kind } = inferTierAndKind(cleanPath)

  const meta: WikiFrontmatter = {
    title: frontmatter.title || path.basename(cleanPath, path.extname(cleanPath)),
    tier: frontmatter.tier || tier,
    kind: frontmatter.kind || kind,
    scope: frontmatter.scope || "projects",
    scope_id: frontmatter.scope_id,
    tags: frontmatter.tags || [],
    pinned: !!frontmatter.pinned,
    created_at: frontmatter.created_at || new Date().toISOString(),
    updated_at: frontmatter.updated_at || new Date().toISOString(),
    expires_at: frontmatter.expires_at,
    confidence: frontmatter.confidence || "high",
    session_id: frontmatter.session_id,
    retention_weight: frontmatter.retention_weight || 1.0,
    access_count: (frontmatter.access_count || 0) + (recordAccess ? 1 : 0),
  }

  if (recordAccess) {
    // Increment access count in background
    try {
      const updatedYaml = yaml.dump(meta).trim()
      const updatedContent = `---\n${updatedYaml}\n---\n\n${body}\n`
      fs.writeFileSync(fullPath, updatedContent, "utf-8")
    } catch {
      // Ignore background write errors
    }
  }

  return {
    ...meta,
    path: cleanPath,
    fullPath,
    content,
    body,
    decayScore: calculateDecayScore(meta),
  }
}

export function deleteWikiPage(relPath: string): boolean {
  const root = getWikiRoot()
  const cleanPath = relPath.replace(/\\/g, "/").replace(/^\/+/, "")
  const fullPath = path.join(root, cleanPath)

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath)
    return true
  }
  return false
}

export function listWikiPages(filter?: {
  tier?: WikiTier
  kind?: WikiKind
  scope?: string
  include_expired?: boolean
}): WikiPageMeta[] {
  const root = getWikiRoot()
  const pages: WikiPageMeta[] = []
  const nowMs = Date.now()

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const ent of entries) {
      const full = path.join(currentDir, ent.name)
      if (ent.isDirectory()) {
        walk(full)
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        const rel = path.relative(root, full).replace(/\\/g, "/")
        const page = readWikiPage(rel, false)
        if (page) {
          if (!filter?.include_expired && page.expires_at && new Date(page.expires_at).getTime() < nowMs) {
            continue
          }
          if (filter?.tier && page.tier !== filter.tier) continue
          if (filter?.kind && page.kind !== filter.kind) continue
          if (filter?.scope && page.scope !== filter.scope) continue
          pages.push(page)
        }
      }
    }
  }

  walk(root)
  return pages.sort((a, b) => b.decayScore - a.decayScore)
}

export function recordPageFeedback(
  relPath: string,
  feedback: "helpful" | "not_helpful" | "stale" | "wrong",
): { success: boolean; newRetentionWeight?: number } {
  const page = readWikiPage(relPath, false)
  if (!page) return { success: false }

  let delta = 0
  if (feedback === "helpful") delta = 0.5
  if (feedback === "not_helpful") delta = -0.3
  if (feedback === "stale") delta = -0.6
  if (feedback === "wrong") delta = -1.0

  const newRetentionWeight = Math.max(0.1, (page.retention_weight || 1.0) + delta)
  const { path: _unusedPath, content: _unusedContent, ...pageProps } = page
  writeWikiPage({
    ...pageProps,
    path: relPath,
    content: page.body,
  })

  return { success: true, newRetentionWeight }
}

export interface WikiLintIssue {
  path: string
  severity: "info" | "warning" | "error"
  issue: string
  recommendation: string
}

export function lintWiki(): { healthy: boolean; issues: WikiLintIssue[] } {
  const pages = listWikiPages({ include_expired: true })
  const issues: WikiLintIssue[] = []
  const nowMs = Date.now()

  const rulesMap = new Map<string, string>()

  for (const p of pages) {
    // 1. Check expiration
    if (p.expires_at && new Date(p.expires_at).getTime() < nowMs) {
      issues.push({
        path: p.path,
        severity: "warning",
        issue: `Page expired on ${p.expires_at}`,
        recommendation: "Delete or refresh page with updated expiration date",
      })
    }

    // 2. Check for low decay score
    if (!p.pinned && p.decayScore < 0.1) {
      issues.push({
        path: p.path,
        severity: "info",
        issue: `Page has decayed significantly (score: ${p.decayScore.toFixed(2)}) without recent access`,
        recommendation: "Consider archiving or consolidating into a concept summary",
      })
    }

    // 3. Check for rule contradictions
    if (p.kind === "rule" || p.path.startsWith("_rules/")) {
      const key = p.title.toLowerCase().trim()
      if (rulesMap.has(key)) {
        issues.push({
          path: p.path,
          severity: "error",
          issue: `Potential rule conflict with ${rulesMap.get(key)}: "${p.title}"`,
          recommendation: "Merge duplicate or conflicting rule definitions",
        })
      } else {
        rulesMap.set(key, p.path)
      }
    }
  }

  return {
    healthy: issues.length === 0,
    issues,
  }
}
