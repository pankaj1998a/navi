/**
 * Spill Storage Engine
 * Ported from DeepSeek Harness (packages/spill/spill & spill-local).
 *
 * Persists large command outputs, compilation logs, or bulky responses to disk
 * and provides compact locators and query mechanisms to prevent LLM context blowouts.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
import fsPromises from "fs/promises"
import readline from "readline"
const DESCRIPTION = "Reads, slices, and searches spilled oversized tool and command outputs."

const log = Log.create({ service: "tool.spill" })

export interface SpillLocator {
  id: string
  path: string
  byteCount: number
  lineCount: number
  preview: string
  retrievalHint: string
}

/** Artifacts older than this are removed by the periodic sweep. */
const SPILL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** Hard cap on retained artifacts per spill dir, oldest deleted first. */
const SPILL_MAX_ARTIFACTS = 200
/** Minimum time between sweeps for the same spill dir. */
const SPILL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000
/** Upper bound on unlinks per sweep so cleanup can never stall a save. */
const SPILL_CLEANUP_MAX_DELETES = 500
const PREVIEW_LINES = 15

const lastCleanup = new Map<string, number>()

interface ArtifactStats {
  byteCount: number
  lineCount: number
  preview: string
}

/**
 * Count newline bytes in `[start, end)` with native `indexOf` (no JS per-byte
 * loop). Chunked so a 100MB spill yields to the event loop every 4MB instead of
 * blocking it for the whole scan.
 */
const COUNT_CHUNK_BYTES = 4 * 1024 * 1024

function countNewlinesSync(buf: Buffer, start = 0, end = buf.length): number {
  let count = 0
  let at = buf.indexOf(0x0a, start)
  while (at !== -1 && at < end) {
    count++
    at = buf.indexOf(0x0a, at + 1)
  }
  return count
}

async function countNewlinesAsync(buf: Buffer): Promise<number> {
  if (buf.length <= COUNT_CHUNK_BYTES) return countNewlinesSync(buf)
  let count = 0
  for (let base = 0; base < buf.length; base += COUNT_CHUNK_BYTES) {
    const end = Math.min(buf.length, base + COUNT_CHUNK_BYTES)
    count += countNewlinesSync(buf, base, end)
    await new Promise((resolve) => setImmediate(resolve))
  }
  return count
}

/**
 * Build the locator stats from an already-counted buffer: the head/tail window
 * only touches `PREVIEW_LINES` line breaks at each end, so no second full scan of
 * the payload is needed. `byteCount` is the buffer length — no `Buffer.byteLength`
 * pass.
 */
function stats(buf: Buffer, lineCount: number): ArtifactStats {
  if (lineCount <= PREVIEW_LINES * 2) {
    return { byteCount: buf.length, lineCount, preview: buf.toString("utf-8") }
  }

  let headEnd = 0
  for (let i = 0; i < PREVIEW_LINES; i++) {
    const next = buf.indexOf(0x0a, headEnd)
    if (next === -1) break
    headEnd = next + 1
  }
  const head = buf.toString("utf-8", 0, Math.max(0, headEnd - 1))

  let tailStart = buf.length
  for (let i = 0; i < PREVIEW_LINES; i++) {
    const prev = buf.lastIndexOf(0x0a, tailStart - 1)
    if (prev === -1) break
    tailStart = prev
  }
  const tail = buf.toString("utf-8", tailStart + 1)
  const omitted = lineCount - PREVIEW_LINES * 2
  return {
    byteCount: buf.length,
    lineCount,
    preview: `${head}\n\n... [${omitted} lines spilled to disk] ...\n\n${tail}`,
  }
}

/**
 * Line-terminator facts the streaming reader cannot observe on its own.
 *
 * The historical reader used `content.split("\n")`, which counts a trailing
 * newline as one more (empty) line and an empty file as a single empty line.
 * `readline` does neither, so the edge is reproduced explicitly to keep line
 * numbers and `totalLines` identical to the previous implementation.
 */
async function terminator(file: string): Promise<{ size: number; endsWithNewline: boolean }> {
  const handle = await fsPromises.open(file, "r")
  try {
    const { size } = await handle.stat()
    if (size === 0) return { size, endsWithNewline: false }
    const last = Buffer.alloc(1)
    await handle.read(last, 0, 1, size - 1)
    return { size, endsWithNewline: last[0] === 0x0a }
  } finally {
    await handle.close()
  }
}

export class SpillStorageManager {
  private getSpillDir(rootDir: string): string {
    const dir = path.join(rootDir, ".navi", "spill")
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  /**
   * Persist `content` and return its locator. The write is asynchronous (libuv
   * threadpool) so a 100MB spill no longer blocks the event loop, and the stats
   * are computed in a single pass.
   */
  async save(rootDir: string, suggestedName: string, content: string): Promise<SpillLocator> {
    const dir = this.getSpillDir(rootDir)
    const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_")
    const id = `spill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const filename = `${id}_${safeName}`
    const fullPath = path.join(dir, filename)

    const buf = Buffer.from(content, "utf-8")
    const counted = stats(buf, 1 + (await countNewlinesAsync(buf)))
    await fsPromises.writeFile(fullPath, buf)

    this.scheduleCleanup(rootDir, dir)
    return this.locator(rootDir, fullPath, id, counted)
  }

  /** Backwards-compatible synchronous variant. Prefer {@link save}. */
  saveText(rootDir: string, suggestedName: string, content: string): SpillLocator {
    const dir = this.getSpillDir(rootDir)
    const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_")
    const id = `spill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const filename = `${id}_${safeName}`
    const fullPath = path.join(dir, filename)

    const buf = Buffer.from(content, "utf-8")
    const counted = stats(buf, 1 + countNewlinesSync(buf))
    fs.writeFileSync(fullPath, buf)

    this.scheduleCleanup(rootDir, dir)
    return this.locator(rootDir, fullPath, id, counted)
  }

  private locator(rootDir: string, fullPath: string, id: string, stats: ArtifactStats): SpillLocator {
    const relPath = path.relative(rootDir, fullPath)
    log.info("Spilled oversized output", {
      id,
      byteCount: stats.byteCount,
      lineCount: stats.lineCount,
      relPath,
    })

    return {
      id,
      path: relPath,
      byteCount: stats.byteCount,
      lineCount: stats.lineCount,
      preview: stats.preview,
      retrievalHint: `Output spilled (${stats.byteCount} bytes, ${stats.lineCount} lines). To read more, use 'spill_read' with id: '${id}', or 'read' with path: '${relPath}'.`,
    }
  }

  /** Fire-and-forget sweep, throttled to once per hour per spill dir. */
  private scheduleCleanup(rootDir: string, dir: string) {
    const now = Date.now()
    const previous = lastCleanup.get(dir)
    // Reserve the slot before the async sweep starts so concurrent saves do not
    // queue duplicate sweeps.
    if (previous !== undefined && now - previous < SPILL_CLEANUP_INTERVAL_MS) return
    lastCleanup.set(dir, now)
    void this.cleanupDir(rootDir, dir).catch((error) => {
      log.debug("spill cleanup failed", { dir, error: String(error) })
      lastCleanup.delete(dir)
    })
  }

  /**
   * Age-based, bounded garbage collection for `.navi/spill`:
   * delete artifacts older than `SPILL_RETENTION_MS`, then trim the remainder to
   * `SPILL_MAX_ARTIFACTS` (oldest first), stopping after
   * `SPILL_CLEANUP_MAX_DELETES` unlinks.
   */
  async cleanupDir(rootDir: string, dir = path.join(rootDir, ".navi", "spill")): Promise<number> {
    let names: string[]
    try {
      names = await fsPromises.readdir(dir)
    } catch {
      return 0
    }
    const now = Date.now()
    const entries: Array<{ name: string; mtimeMs: number }> = []
    for (const name of names) {
      if (!name.startsWith("spill_")) continue
      try {
        const stat = await fsPromises.stat(path.join(dir, name))
        entries.push({ name, mtimeMs: stat.mtimeMs })
      } catch {
        // Vanished or unreadable — nothing to reclaim.
      }
    }

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    const doomed = new Set<string>()
    for (const entry of entries) {
      if (now - entry.mtimeMs > SPILL_RETENTION_MS) doomed.add(entry.name)
    }
    const survivors = entries.filter((entry) => !doomed.has(entry.name))
    const overflow = survivors.length - SPILL_MAX_ARTIFACTS
    for (let i = 0; i < overflow; i++) {
      const entry = survivors[i]
      if (entry) doomed.add(entry.name)
    }

    let removed = 0
    for (const name of doomed) {
      if (removed >= SPILL_CLEANUP_MAX_DELETES) break
      try {
        await fsPromises.rm(path.join(dir, name), { force: true })
        removed++
      } catch {
        // Another process may have removed it first.
      }
    }
    if (removed) log.info("spill cleanup", { dir, removed })
    return removed
  }

  async readSpill(
    rootDir: string,
    idOrPath: string,
    options?: { offset?: number; limit?: number; query?: string },
  ): Promise<{ content: string; totalLines: number; matchedLines?: number }> {
    const dir = this.getSpillDir(rootDir)
    let targetFile: string

    if (fs.existsSync(idOrPath)) {
      targetFile = idOrPath
    } else if (fs.existsSync(path.resolve(rootDir, idOrPath))) {
      targetFile = path.resolve(rootDir, idOrPath)
    } else {
      // Find by ID prefix in spill dir
      const entries = await fsPromises.readdir(dir)
      const found = entries.find((e) => e.startsWith(idOrPath) || e.includes(idOrPath))
      if (!found) {
        throw new Error(`Spill artifact not found for id/path: ${idOrPath}`)
      }
      targetFile = path.join(dir, found)
    }

    const edge = await terminator(targetFile)
    /** Extra empty line produced by `split("\n")` on `""` / trailing newline. */
    const trailing = edge.size === 0 ? "only" : edge.endsWithNewline ? "after" : undefined
    const offset = Math.max(0, (options?.offset ?? 1) - 1)
    const limit = options?.limit ?? 100

    // An empty artifact is a single empty line; there is nothing to stream.
    if (trailing === "only" && !options?.query) {
      return { content: limit > 0 ? "L1: " : "", totalLines: 1 }
    }

    const stream = fs.createReadStream(targetFile, { encoding: "utf-8" })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

    let totalLines = 0
    if (options?.query) {
      const regex = new RegExp(options.query, "i")
      const matched: string[] = []
      let matchCount = 0

      for await (const line of rl) {
        totalLines++
        if (regex.test(line)) {
          matchCount++
          if (matched.length < limit) {
            matched.push(`L${totalLines}: ${line}`)
          }
        }
      }
      if (trailing) totalLines++

      return {
        content: matched.join("\n"),
        totalLines,
        matchedLines: matchCount,
      }
    }

    const slice: string[] = []

    for await (const line of rl) {
      totalLines++
      if (totalLines > offset && slice.length < limit) slice.push(`L${totalLines}: ${line}`)
    }
    if (trailing === "after") {
      totalLines++
      if (totalLines > offset && slice.length < limit) slice.push(`L${totalLines}: `)
    }

    return {
      content: slice.join("\n"),
      totalLines,
    }
  }
}

export const SpillStore = new SpillStorageManager()

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({
    description: "Spill ID or path (e.g. 'spill_1728000000_output.txt' or '.navi/spill/...')",
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "1-indexed starting line number (default: 1)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of lines to retrieve (default: 100)",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Optional regex or substring to search for within the spilled artifact",
  }),
})

export const SpillReadTool = Tool.define(
  "spill_read",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const rootDir = instance.directory

          const result = yield* Effect.promise(() =>
            SpillStore.readSpill(rootDir, params.id, {
              offset: params.offset,
              limit: params.limit,
              query: params.query,
            }),
          )

          return {
            title: `Read Spill Artifact: ${params.id}`,
            output: [
              `📑 **Spill Artifact Viewer**`,
              `- **Artifact**: \`${params.id}\``,
              `- **Total Lines**: ${result.totalLines}`,
              result.matchedLines !== undefined ? `- **Matches Found**: ${result.matchedLines}` : "",
              "",
              "```",
              result.content || "(No lines to display)",
              "```",
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: { ...result } as Record<string, unknown>,
          }
        }),
    }
  }),
)
