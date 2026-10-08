/**
 * Segmented Compaction Transcript Store.
 * Ported from SpaceXAI Grok Build (crates/codegen/xai-compaction-transcript).
 *
 * Persists verbatim compacted turns into numbered markdown segments under
 * `.navi/compaction/` and maintains an `INDEX.md` index table in the workspace.
 * This gives the agent and user infinite recall of past turns with zero context bloat.
 */

import fs from "fs"
import path from "path"
import type { MessageV2 } from "./message-v2"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "session.segmented-compaction" })

export type CompactionDetail = "none" | "minimal" | "balanced" | "verbose"

export interface ArchiveOptions {
  worktree: string
  sessionID: string
  messages: MessageV2.WithParts[]
  summary: string
  detail?: CompactionDetail
}

export interface ArchiveResult {
  segmentFile: string
  indexFile: string
  segmentNumber: number
  turnCount: number
}

const INDEX_HEADER = `# Session Compaction Index\n\n| Segment | Date | Turns | Summary | File |\n|---|---|---|---|---|\n`

export function archiveSegment(opts: ArchiveOptions): ArchiveResult | undefined {
  try {
    const compactionDir = path.join(opts.worktree, ".navi", "compaction")
    if (!fs.existsSync(compactionDir)) {
      fs.mkdirSync(compactionDir, { recursive: true })
    }

    const indexFile = path.join(compactionDir, "INDEX.md")
    if (!fs.existsSync(indexFile)) {
      fs.writeFileSync(indexFile, INDEX_HEADER, "utf-8")
    }

    // Determine next segment number by inspecting existing segment_*.md files
    const existing = fs.readdirSync(compactionDir).filter((f) => f.startsWith("segment_") && f.endsWith(".md"))
    const segmentNumber = existing.length + 1
    const padNum = String(segmentNumber).padStart(3, "0")
    const segmentFileName = `segment_${padNum}.md`
    const segmentFilePath = path.join(compactionDir, segmentFileName)

    const detail = opts.detail ?? "balanced"
    const now = new Date().toISOString().replace("T", " ").slice(0, 16)
    const turnCount = opts.messages.length

    // Render segment content
    const lines: string[] = [
      `# Compaction Segment ${padNum}`,
      `* Session: \`${opts.sessionID}\``,
      `* Archived: ${now}`,
      `* Turns: ${turnCount}`,
      `* Detail Level: \`${detail}\``,
      "",
      "## Summary",
      opts.summary.trim(),
      "",
      "---",
      "## Verbatim Turns",
      "",
    ]

    if (detail !== "none") {
      let turnIdx = 1
      for (const msg of opts.messages) {
        lines.push(`### Turn ${turnIdx} [${msg.info.role.toUpperCase()}]`)
        for (const part of msg.parts) {
          if (part.type === "text") {
            const text = (part as any).text ?? ""
            if (detail === "minimal") {
              const snippet = text.slice(0, 120).replace(/\n/g, " ")
              lines.push(`> ${snippet}${text.length > 120 ? "..." : ""}`)
            } else if (detail === "balanced" && text.length > 1500) {
              lines.push(text.slice(0, 1500) + "\n\n*(text truncated for balanced detail)*")
            } else {
              lines.push(text)
            }
          } else if (part.type === "tool") {
            const toolName = (part as any).tool ?? "unknown"
            const status = (part as any).state?.status ?? "done"
            lines.push(`- **Tool Call**: \`${toolName}\` (${status})`)
          }
        }
        lines.push("")
        turnIdx++
      }
    }

    fs.writeFileSync(segmentFilePath, lines.join("\n"), "utf-8")

    // Append to INDEX.md
    const cleanSummary = opts.summary
      .split("\n")[0]
      ?.replace(/\|/g, "-")
      .slice(0, 80) || "Routine compaction"
    const relativePath = path.join(".navi", "compaction", segmentFileName).replace(/\\/g, "/")
    const row = `| ${padNum} | ${now} | ${turnCount} turns | ${cleanSummary} | [\`${segmentFileName}\`](${relativePath}) |\n`
    fs.appendFileSync(indexFile, row, "utf-8")

    log.info("archived compaction segment", { segment: segmentFileName, turns: turnCount })

    return {
      segmentFile: segmentFilePath,
      indexFile,
      segmentNumber,
      turnCount,
    }
  } catch (err) {
    log.error("failed to archive compaction segment", { error: String(err) })
    return undefined
  }
}
