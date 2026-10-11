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

export class SpillStorageManager {
  private getSpillDir(rootDir: string): string {
    const dir = path.join(rootDir, ".navi", "spill")
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  saveText(rootDir: string, suggestedName: string, content: string): SpillLocator {
    const dir = this.getSpillDir(rootDir)
    const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, "_")
    const id = `spill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const filename = `${id}_${safeName}`
    const fullPath = path.join(dir, filename)

    fs.writeFileSync(fullPath, content, "utf-8")

    const lines = content.split("\n")
    const lineCount = lines.length
    const byteCount = Buffer.byteLength(content, "utf-8")

    let preview: string
    if (lineCount <= 30) {
      preview = content
    } else {
      const head = lines.slice(0, 15).join("\n")
      const tail = lines.slice(-15).join("\n")
      const omitted = lineCount - 30
      preview = `${head}\n\n... [${omitted} lines spilled to disk] ...\n\n${tail}`
    }

    const relPath = path.relative(rootDir, fullPath)
    log.info("Spilled oversized output", { id, byteCount, lineCount, relPath })

    return {
      id,
      path: relPath,
      byteCount,
      lineCount,
      preview,
      retrievalHint: `Output spilled (${byteCount} bytes, ${lineCount} lines). To read more, use 'spill_read' with id: '${id}', or 'read' with path: '${relPath}'.`,
    }
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

    const raw = await fsPromises.readFile(targetFile, "utf-8")
    const lines = raw.split("\n")
    const totalLines = lines.length

    if (options?.query) {
      const regex = new RegExp(options.query, "i")
      const matched: string[] = []
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          matched.push(`L${i + 1}: ${lines[i]}`)
        }
      }
      return {
        content: matched.slice(0, options.limit ?? 100).join("\n"),
        totalLines,
        matchedLines: matched.length,
      }
    }

    const offset = Math.max(0, (options?.offset ?? 1) - 1)
    const limit = options?.limit ?? 100
    const slice = lines.slice(offset, offset + limit)

    return {
      content: slice.map((line, idx) => `L${offset + idx + 1}: ${line}`).join("\n"),
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
