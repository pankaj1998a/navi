/**
 * Ported from SpaceXAI Grok Build (xai-hunk-tracker crate)
 *
 * Maintains a live session-level registry of all diff hunks applied to files.
 * Provides hunk lifecycle management (Applied, Reverted, Rejected), collision/overlap
 * detection between successive agent edits, and line-level traceability.
 */

import crypto from "crypto"
import path from "path"
import fs from "fs/promises"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "hunk-tracker" })

export type HunkStatus = "applied" | "reverted" | "rejected" | "pending"

export interface HunkRecord {
  id: string
  filePath: string
  startLine: number // 1-indexed
  lineCount: number
  added: number
  removed: number
  oldLines: string[]
  newLines: string[]
  summary: string
  status: HunkStatus
  timestamp: number
}

export interface OverlapCollision {
  existingHunk: HunkRecord
  conflictRange: { start: number; end: number }
}

export class SessionHunkTracker {
  private hunks: Map<string, HunkRecord> = new Map()

  /**
   * Records an applied hunk in the session registry.
   */
  recordHunk(params: {
    filePath: string
    startLine: number
    oldLines: string[]
    newLines: string[]
    summary?: string
  }): HunkRecord {
    const id = `hnk_${crypto.randomBytes(6).toString("hex")}`
    const normPath = path.normalize(params.filePath)
    const added = params.newLines.length
    const removed = params.oldLines.length
    const lineCount = Math.max(added, removed, 1)

    const record: HunkRecord = {
      id,
      filePath: normPath,
      startLine: Math.max(1, params.startLine),
      lineCount,
      added,
      removed,
      oldLines: [...params.oldLines],
      newLines: [...params.newLines],
      summary: params.summary || `Update ${path.basename(normPath)}:L${params.startLine} (+${added}/-${removed})`,
      status: "applied",
      timestamp: Date.now(),
    }

    this.hunks.set(id, record)
    log.info("Recorded hunk", { id, file: normPath, startLine: record.startLine, added, removed })
    return record
  }

  /**
   * Checks if an incoming edit range overlaps with previously applied active hunks.
   */
  detectOverlap(filePath: string, startLine: number, lineCount: number): OverlapCollision | null {
    const normPath = path.normalize(filePath)
    const targetEnd = startLine + lineCount

    for (const hunk of this.hunks.values()) {
      if (hunk.filePath !== normPath || hunk.status !== "applied") continue

      const hunkEnd = hunk.startLine + hunk.lineCount
      // Check for interval intersection: max(start1, start2) < min(end1, end2)
      if (Math.max(startLine, hunk.startLine) < Math.min(targetEnd, hunkEnd)) {
        return {
          existingHunk: hunk,
          conflictRange: {
            start: Math.max(startLine, hunk.startLine),
            end: Math.min(targetEnd, hunkEnd),
          },
        }
      }
    }

    return null
  }

  /**
   * Returns all hunks for a specific file.
   */
  getHunksForFile(filePath: string): HunkRecord[] {
    const normPath = path.normalize(filePath)
    return Array.from(this.hunks.values()).filter((h) => h.filePath === normPath)
  }

  /**
   * Returns all recorded hunks across all files.
   */
  getAllHunks(): HunkRecord[] {
    return Array.from(this.hunks.values())
  }

  /**
   * Retrieves a hunk by ID.
   */
  getHunk(id: string): HunkRecord | undefined {
    return this.hunks.get(id)
  }

  /**
   * Reverts a recorded hunk by restoring old lines.
   */
  async revertHunk(id: string): Promise<boolean> {
    const hunk = this.hunks.get(id)
    if (!hunk || hunk.status !== "applied") return false

    try {
      const raw = await fs.readFile(hunk.filePath, "utf-8")
      const lines = raw.split("\n")

      const targetStart = hunk.startLine - 1
      const targetEnd = targetStart + hunk.newLines.length

      // Verify the current lines match the hunk's newLines
      const currentSpan = lines.slice(targetStart, targetEnd)
      const matches = currentSpan.join("\n") === hunk.newLines.join("\n")

      if (!matches) {
        log.warn("Cannot revert hunk cleanly; content modified externally", { id, file: hunk.filePath })
        return false
      }

      // Splice original lines back in
      lines.splice(targetStart, hunk.newLines.length, ...hunk.oldLines)
      await fs.writeFile(hunk.filePath, lines.join("\n"), "utf-8")

      hunk.status = "reverted"
      log.info("Reverted hunk successfully", { id, file: hunk.filePath })
      return true
    } catch (err) {
      log.error("Failed to revert hunk", { id, err })
      return false
    }
  }

  /**
   * Marks a hunk as accepted.
   */
  acceptHunk(id: string): boolean {
    const hunk = this.hunks.get(id)
    if (!hunk) return false
    hunk.status = "applied"
    return true
  }

  /**
   * Clears all tracked hunks.
   */
  clear(): void {
    this.hunks.clear()
  }
}

// Global session singleton instance
export const HunkTracker = new SessionHunkTracker()
