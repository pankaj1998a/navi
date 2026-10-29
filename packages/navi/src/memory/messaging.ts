/**
 * Cross-Project Asynchronous Agent Messaging Protocol
 * Ported from ai-memory's agent messaging system.
 * Allows agents in different projects/workspaces to drop self-contained
 * asynchronous tasks or queries into recipient project inboxes.
 * Claim-once semantics: once popped, a message is consumed and marked completed.
 */

import { Database } from "@/storage/db"
import crypto from "node:crypto"
import { sanitizeText } from "./sanitize"

export interface AgentMessage {
  id: string
  created_at: string
  status: "pending" | "popped" | "cancelled"
  from_project: string
  to_project: string
  title: string
  body: string
  popped_at?: string
  popped_by?: string
}

export interface SendMessageInput {
  from_project: string
  to_project: string
  title: string
  body: string
}

export interface PopMessageResult {
  success: boolean
  message?: AgentMessage
  reason?: string
}

let tableInitialized = false

export function ensureMessageTable(): void {
  if (tableInitialized) return
  const db = Database.Client().$client
  db.run(`
    CREATE TABLE IF NOT EXISTS navi_memory_messages (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      from_project TEXT NOT NULL,
      to_project TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      popped_at INTEGER,
      popped_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_navi_messages_inbox ON navi_memory_messages (to_project, status, created_at);
  `)
  tableInitialized = true
}

export function sendMessage(input: SendMessageInput): AgentMessage {
  ensureMessageTable()
  const db = Database.Client().$client
  const now = Date.now()
  const id = `msg_${now}_${crypto.randomBytes(4).toString("hex")}`

  const message: AgentMessage = {
    id,
    created_at: new Date(now).toISOString(),
    status: "pending",
    from_project: input.from_project.trim(),
    to_project: input.to_project.trim(),
    title: sanitizeText(input.title.trim()),
    body: sanitizeText(input.body.trim()),
  }

  db.run(
    `INSERT INTO navi_memory_messages (
      id, created_at, status, from_project, to_project, title, body, popped_at, popped_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      now,
      message.status,
      message.from_project,
      message.to_project,
      message.title,
      message.body,
      null,
      null,
    ],
  )

  return message
}

export function listMessages(filter: {
  project: string
  direction?: "inbox" | "outbox"
  status?: "pending" | "popped" | "cancelled" | "all"
}): AgentMessage[] {
  ensureMessageTable()
  const db = Database.Client().$client
  const direction = filter.direction || "inbox"
  const status = filter.status || "pending"

  let query = "SELECT * FROM navi_memory_messages WHERE 1=1"
  const params: unknown[] = []

  if (direction === "inbox") {
    query += " AND to_project = ?"
    params.push(filter.project.trim())
  } else {
    query += " AND from_project = ?"
    params.push(filter.project.trim())
  }

  if (status !== "all") {
    query += " AND status = ?"
    params.push(status)
  }

  query += " ORDER BY created_at ASC"

  const rows = db.query(query).all(...(params as any[])) as Array<{
    id: string
    created_at: number
    status: string
    from_project: string
    to_project: string
    title: string
    body: string
    popped_at: number | null
    popped_by: string | null
  }>

  return rows.map((r) => ({
    id: r.id,
    created_at: new Date(r.created_at).toISOString(),
    status: r.status as AgentMessage["status"],
    from_project: r.from_project,
    to_project: r.to_project,
    title: r.title,
    body: r.body,
    popped_at: r.popped_at ? new Date(r.popped_at).toISOString() : undefined,
    popped_by: r.popped_by || undefined,
  }))
}

export function popMessage(filter: {
  project: string
  message_id?: string
  popped_by?: string
}): PopMessageResult {
  ensureMessageTable()
  const db = Database.Client().$client
  const now = Date.now()
  const poppedBy = filter.popped_by || "agent"

  let candidateId: string | null = null

  if (filter.message_id) {
    candidateId = filter.message_id
  } else {
    const row = db
      .query(
        `SELECT id FROM navi_memory_messages 
         WHERE to_project = ? AND status = 'pending' 
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(filter.project.trim()) as { id: string } | null
    candidateId = row?.id || null
  }

  if (!candidateId) {
    return { success: false, reason: "No pending messages found in project inbox" }
  }

  // Atomic claim
  const result = db.run(
    `UPDATE navi_memory_messages 
     SET status = 'popped', popped_at = ?, popped_by = ? 
     WHERE id = ? AND status = 'pending'`,
    [now, poppedBy, candidateId],
  )

  if (result.changes === 0) {
    return { success: false, reason: `Message ${candidateId} was already popped or cancelled` }
  }

  const row = db.query(`SELECT * FROM navi_memory_messages WHERE id = ?`).get(candidateId) as {
    id: string
    created_at: number
    status: string
    from_project: string
    to_project: string
    title: string
    body: string
    popped_at: number | null
    popped_by: string | null
  }

  return {
    success: true,
    message: {
      id: row.id,
      created_at: new Date(row.created_at).toISOString(),
      status: row.status as AgentMessage["status"],
      from_project: row.from_project,
      to_project: row.to_project,
      title: row.title,
      body: row.body,
      popped_at: row.popped_at ? new Date(row.popped_at).toISOString() : undefined,
      popped_by: row.popped_by || undefined,
    },
  }
}

export function cancelMessage(messageId: string): boolean {
  ensureMessageTable()
  const db = Database.Client().$client
  const result = db.run(
    `UPDATE navi_memory_messages SET status = 'cancelled' WHERE id = ? AND status = 'pending'`,
    [messageId],
  )
  return result.changes > 0
}
