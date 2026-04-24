/**
 * Navi VCR — Session Recording & Replay
 *
 * Records all session events (messages, tool calls, outputs) to a file.
 * Recordings can be replayed deterministically for debugging and testing.
 *
 * Storage: .navi/recordings/<session-id>.navi-vcr.jsonl
 */

import path from "path"
import { Log } from "../util/log"
import { Global } from "../global"

const log = Log.create({ service: "vcr" })

export type VCREventType =
  | "session-start"
  | "session-end"
  | "user-message"
  | "assistant-message"
  | "tool-call"
  | "tool-result"
  | "error"

export type VCREvent = {
  type: VCREventType
  timestamp: string
  sessionID: string
  data: unknown
}

export type VCRRecording = {
  version: 1
  sessionID: string
  startedAt: string
  endedAt?: string
  events: VCREvent[]
}

// Active recording sessions
const active = new Map<string, VCREvent[]>()

function recordingPath(sessionID: string): string {
  return path.join(Global.Path.state, "recordings", `${sessionID}.navi-vcr.jsonl`)
}

// ─── Recording ────────────────────────────────────────────────────────────────

/**
 * Start recording a session.
 */
export function startRecording(sessionID: string): void {
  if (active.has(sessionID)) {
    log.warn("already recording", { sessionID })
    return
  }
  active.set(sessionID, [])
  record(sessionID, "session-start", { sessionID })
  log.info("recording started", { sessionID })
}

/**
 * Stop recording and persist to disk.
 */
export async function stopRecording(sessionID: string): Promise<string | null> {
  const events = active.get(sessionID)
  if (!events) return null

  record(sessionID, "session-end", { sessionID })
  active.delete(sessionID)

  const filePath = recordingPath(sessionID)
  const dir = path.dirname(filePath)

  try {
    // Ensure recordings directory exists
    const dirFile = Bun.file(dir)
    if (!(await dirFile.exists())) {
      await Bun.spawn(["mkdir", "-p", dir]).exited
    }

    const lines = events.map((e) => JSON.stringify(e)).join("\n")
    await Bun.write(filePath, lines + "\n")
    log.info("recording saved", { sessionID, path: filePath, events: events.length })
    return filePath
  } catch (err) {
    log.error("failed to save recording", { sessionID, err })
    return null
  }
}

/**
 * Record an event for an active session.
 */
export function record(sessionID: string, type: VCREventType, data: unknown): void {
  const events = active.get(sessionID)
  if (!events) return

  events.push({
    type,
    timestamp: new Date().toISOString(),
    sessionID,
    data,
  })
}

/**
 * Check if a session is currently being recorded.
 */
export function isRecording(sessionID: string): boolean {
  return active.has(sessionID)
}

// ─── Replay ───────────────────────────────────────────────────────────────────

/**
 * Load a recording from disk.
 */
export async function loadRecording(filePathOrSessionID: string): Promise<VCREvent[]> {
  // Resolve path: if it looks like a session ID (no path separators), construct path
  const filePath = filePathOrSessionID.includes(path.sep) || filePathOrSessionID.includes("/")
    ? filePathOrSessionID
    : recordingPath(filePathOrSessionID)

  try {
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      throw new Error(`Recording not found: ${filePath}`)
    }
    const text = await file.text()
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as VCREvent)
  } catch (err) {
    throw new Error(`Failed to load recording: ${err}`)
  }
}

/**
 * List all available recordings.
 */
export async function listRecordings(): Promise<{ sessionID: string; path: string; size: number }[]> {
  const dir = path.join(Global.Path.state, "recordings")
  try {
    const glob = new Bun.Glob("*.navi-vcr.jsonl")
    const recordings: { sessionID: string; path: string; size: number }[] = []

    for await (const file of glob.scan({ cwd: dir, absolute: true })) {
      const sessionID = path.basename(file, ".navi-vcr.jsonl")
      const stat = Bun.file(file)
      recordings.push({ sessionID, path: file, size: stat.size })
    }

    return recordings
  } catch {
    return []
  }
}

/**
 * Generate a human-readable summary of a recording.
 */
export async function summarizeRecording(sessionID: string): Promise<string> {
  const events = await loadRecording(sessionID)
  if (events.length === 0) return "Empty recording."

  const start = events.find((e) => e.type === "session-start")
  const end = events.find((e) => e.type === "session-end")
  const toolCalls = events.filter((e) => e.type === "tool-call")
  const errors = events.filter((e) => e.type === "error")

  return [
    `## Recording: ${sessionID}`,
    `Started: ${start?.timestamp ?? "unknown"}`,
    `Ended: ${end?.timestamp ?? "in progress"}`,
    `Total events: ${events.length}`,
    `Tool calls: ${toolCalls.length}`,
    `Errors: ${errors.length}`,
    ``,
    `### Event Timeline:`,
    ...events.map((e) => `- [${e.timestamp}] ${e.type}`),
  ].join("\n")
}

// ─── VCR namespace ────────────────────────────────────────────────────────────

export namespace VCR {
  export const start = startRecording
  export const stop = stopRecording
  export const save = record
  export const load = loadRecording
  export const list = listRecordings
  export const summarize = summarizeRecording
  export const recording = isRecording
}
