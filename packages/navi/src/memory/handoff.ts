/**
 * Cross-Agent Typed Claim-Once Handoff Protocol
 * Ported from ai-memory's handoff architecture.
 * Enables switching between coding agents (Claude Code, Codex, Navi, Cursor, Devin)
 * mid-task without losing architecture context, failed approaches, or open questions.
 * Each handoff has an owner and can be claimed atomically exactly once.
 */

import { Database } from "@/storage/db"
import path from "node:path"
import crypto from "node:crypto"
import { sanitizeText } from "./sanitize"

export interface HandoffRecord {
  id: string
  created_at: string
  updated_at: string
  expires_at?: string
  status: "open" | "claimed" | "expired" | "cancelled"
  owner: string
  claimed_by?: string
  claimed_at?: string
  shared: boolean
  target_directory: string
  project?: string
  summary: string
  open_questions: string[]
  next_steps: string[]
  context_data?: Record<string, unknown>
}

export interface HandoffBeginInput {
  summary: string
  open_questions?: string[]
  next_steps?: string[]
  target_directory?: string
  project?: string
  owner?: string
  shared?: boolean
  expires_in_hours?: number
  context_data?: Record<string, unknown>
}

export type AcceptStatus = "claimed" | "consumed_by_hook" | "none_pending"

export interface AcceptHandoffResult {
  status: AcceptStatus
  handoff?: HandoffRecord
  reason?: string
}

let tableInitialized = false

export function ensureHandoffTable(): void {
  if (tableInitialized) return
  const db = Database.Client().$client
  db.run(`
    CREATE TABLE IF NOT EXISTS navi_memory_handoffs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER,
      status TEXT NOT NULL,
      owner TEXT NOT NULL,
      claimed_by TEXT,
      claimed_at INTEGER,
      shared INTEGER NOT NULL DEFAULT 0,
      target_directory TEXT NOT NULL,
      project TEXT,
      summary TEXT NOT NULL,
      open_questions TEXT NOT NULL,
      next_steps TEXT NOT NULL,
      context_data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_navi_handoffs_lookup ON navi_memory_handoffs (status, target_directory, created_at);
  `)
  tableInitialized = true
}

export function normalizeDirectory(dir: string): string {
  try {
    return path.resolve(dir).replace(/\\/g, "/").toLowerCase().replace(/\/$/, "")
  } catch {
    return dir.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "")
  }
}

export function beginHandoff(input: HandoffBeginInput): HandoffRecord {
  ensureHandoffTable()
  const db = Database.Client().$client
  const now = Date.now()
  const id = `ho_${now}_${crypto.randomBytes(4).toString("hex")}`
  const targetDir = normalizeDirectory(input.target_directory || process.cwd())
  const expiresAt = input.expires_in_hours ? now + input.expires_in_hours * 3600 * 1000 : null

  // If there are prior automatic open handoffs for this exact directory, expire them
  db.run(
    `UPDATE navi_memory_handoffs 
     SET status = 'expired', updated_at = ? 
     WHERE target_directory = ? AND status = 'open'`,
    [now, targetDir],
  )

  const record: HandoffRecord = {
    id,
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    status: "open",
    owner: input.owner || "agent",
    shared: !!input.shared,
    target_directory: targetDir,
    project: input.project,
    summary: sanitizeText(input.summary.trim()),
    open_questions: input.open_questions ? input.open_questions.map((q) => sanitizeText(q)) : [],
    next_steps: input.next_steps ? input.next_steps.map((s) => sanitizeText(s)) : [],
    context_data: input.context_data,
  }

  db.run(
    `INSERT INTO navi_memory_handoffs (
      id, created_at, updated_at, expires_at, status, owner, claimed_by, claimed_at,
      shared, target_directory, project, summary, open_questions, next_steps, context_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      now,
      now,
      expiresAt,
      record.status,
      record.owner,
      null,
      null,
      record.shared ? 1 : 0,
      record.target_directory,
      record.project || null,
      record.summary,
      JSON.stringify(record.open_questions),
      JSON.stringify(record.next_steps),
      record.context_data ? JSON.stringify(record.context_data) : null,
    ],
  )

  return record
}

export function listHandoffs(filter?: {
  target_directory?: string
  status?: "open" | "claimed" | "expired" | "cancelled" | "all"
  owner?: string
}): HandoffRecord[] {
  ensureHandoffTable()
  const db = Database.Client().$client
  const now = Date.now()

  let query = "SELECT * FROM navi_memory_handoffs WHERE 1=1"
  const params: unknown[] = []

  const status = filter?.status || "open"
  if (status !== "all") {
    query += " AND status = ?"
    params.push(status)
  }

  if (filter?.target_directory) {
    const norm = normalizeDirectory(filter.target_directory)
    query += " AND target_directory = ?"
    params.push(norm)
  }

  if (filter?.owner) {
    query += " AND (owner = ? OR shared = 1)"
    params.push(filter.owner)
  }

  // Filter out expired by time
  query += " AND (expires_at IS NULL OR expires_at > ?)"
  params.push(now)

  query += " ORDER BY created_at DESC"

  const rows = db.query(query).all(...(params as any[])) as Array<{
    id: string
    created_at: number
    updated_at: number
    expires_at: number | null
    status: string
    owner: string
    claimed_by: string | null
    claimed_at: number | null
    shared: number
    target_directory: string
    project: string | null
    summary: string
    open_questions: string
    next_steps: string
    context_data: string | null
  }>

  return rows.map((r) => ({
    id: r.id,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : undefined,
    status: r.status as HandoffRecord["status"],
    owner: r.owner,
    claimed_by: r.claimed_by || undefined,
    claimed_at: r.claimed_at ? new Date(r.claimed_at).toISOString() : undefined,
    shared: r.shared === 1,
    target_directory: r.target_directory,
    project: r.project || undefined,
    summary: r.summary,
    open_questions: JSON.parse(r.open_questions || "[]"),
    next_steps: JSON.parse(r.next_steps || "[]"),
    context_data: r.context_data ? JSON.parse(r.context_data) : undefined,
  }))
}

export function acceptHandoff(filter?: {
  handoff_id?: string
  target_directory?: string
  claimed_by?: string
}): AcceptHandoffResult {
  ensureHandoffTable()
  const db = Database.Client().$client
  const now = Date.now()
  const claimedBy = filter?.claimed_by || "current_agent"

  let candidateId: string | null = null

  if (filter?.handoff_id) {
    candidateId = filter.handoff_id
  } else {
    // Find newest open handoff matching directory
    const targetDir = normalizeDirectory(filter?.target_directory || process.cwd())
    const row = db
      .query(
        `SELECT id FROM navi_memory_handoffs 
         WHERE status = 'open' AND target_directory = ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(targetDir, now) as { id: string } | null
    candidateId = row?.id || null
  }

  if (!candidateId) {
    return { status: "none_pending", reason: "No open handoff found matching target directory" }
  }

  // Atomic claim
  const result = db.run(
    `UPDATE navi_memory_handoffs 
     SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ? 
     WHERE id = ? AND status = 'open'`,
    [claimedBy, now, now, candidateId],
  )

  if (result.changes === 0) {
    const existing = db.query(`SELECT status, claimed_by FROM navi_memory_handoffs WHERE id = ?`).get(candidateId) as {
      status: string
      claimed_by: string | null
    } | null
    if (existing?.status === "claimed") {
      return {
        status: "consumed_by_hook",
        reason: `Handoff ${candidateId} was already claimed by ${existing.claimed_by || "another agent"}`,
      }
    }
    return { status: "none_pending", reason: `Handoff ${candidateId} is no longer open (${existing?.status || "missing"})` }
  }

  const list = listHandoffs({ status: "all" })
  const claimed = list.find((h) => h.id === candidateId)

  return {
    status: "claimed",
    handoff: claimed,
  }
}

export function cancelHandoff(handoffId: string): boolean {
  ensureHandoffTable()
  const db = Database.Client().$client
  const now = Date.now()
  const result = db.run(
    `UPDATE navi_memory_handoffs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'open'`,
    [now, handoffId],
  )
  return result.changes > 0
}
