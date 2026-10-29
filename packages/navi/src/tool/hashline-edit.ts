/**
 * Hashline Content-Addressed Editing Engine
 * Ported from xAI Grok Build (grok_build_hashline).
 *
 * Employs 4-hex-char hash-anchored lines (LINE:HASH) with radius-based
 * shifted-line recovery (find_shifted) to guarantee resilient edits even when
 * surrounding file edits shift line numbers.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@navi-ai/core/filesystem"
import * as Bom from "@/util/bom"
import path from "path"
import { createTwoFilesPatch, diffLines } from "diff"
import { Snapshot } from "@/snapshot"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { LSP } from "@/lsp/lsp"
import { assertWriteAllowed, askEditUnlessMemory } from "./external-directory"
import { SandboxPathGuard } from "@/sandbox"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "tool.hashline-edit" })

const DESCRIPTION =
  "Edits files with content-addressed line anchors (e.g. '42:a1b2'). Automatically recovers from line drift via radius search."

/**
 * Computes a 16-bit FNV-1a hash formatted as 4 hex characters
 */
export function computeLineHash(line: string): string {
  const trimmed = line.trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < trimmed.length; i++) {
    hash ^= trimmed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) & 0xffff).toString(16).padStart(4, "0")
}

/**
 * Parses an anchor of form "42:a1b2" or "42:a1b2:c3d4"
 */
export function parseAnchor(anchorStr: string): { line: number; hash: string } {
  const parts = anchorStr.trim().split(":")
  if (parts.length < 2) {
    throw new Error(`Invalid hashline anchor format: "${anchorStr}". Expected "LINE:HASH" (e.g. "42:a1b2").`)
  }
  const line = parseInt(parts[0]!, 10)
  if (isNaN(line) || line < 1) {
    throw new Error(`Invalid line number in anchor: "${anchorStr}"`)
  }
  const hash = parts[1]!.toLowerCase()
  return { line, hash }
}

/**
 * Finds the actual 0-indexed line index in lines array matching the target anchor,
 * searching outward up to radius lines to recover from line shifts.
 */
export function findShifted(anchorStr: string, lines: string[], radius = 15): number {
  const { line, hash } = parseAnchor(anchorStr)
  const targetIdx = line - 1

  // Check direct line first
  if (targetIdx >= 0 && targetIdx < lines.length) {
    if (computeLineHash(lines[targetIdx]!) === hash) {
      return targetIdx
    }
  }

  // Search outward within radius
  for (let d = 1; d <= radius; d++) {
    const prev = targetIdx - d
    if (prev >= 0 && prev < lines.length && computeLineHash(lines[prev]!) === hash) {
      log.info("Hashline recovered shifted line", { requested: line, found: prev + 1, shift: -d })
      return prev
    }
    const next = targetIdx + d
    if (next < lines.length && computeLineHash(lines[next]!) === hash) {
      log.info("Hashline recovered shifted line", { requested: line, found: next + 1, shift: d })
      return next
    }
  }

  throw new Error(
    `Anchor "${anchorStr}" could not be resolved within radius of ${radius} lines. Line content may have changed significantly.`,
  )
}

/**
 * Strips accidental anchor prefixes copied by models (e.g. "42:a1b2│..." or "42:a1b2->...")
 */
export function stripAnchorPrefixes(text: string): string {
  const lines = text.split("\n")
  const stripped = lines.map((l) => {
    // Match line anchor patterns like "42:a1b2│" or "42:a1b2->" or "42:a1b2:c3d4 "
    return l.replace(/^\s*\d+:[0-9a-fA-F]{4}(?::[0-9a-fA-F]{4})?[│|→\->\s]\s?/, "")
  })
  return stripped.join("\n")
}

export const HashlineOp = Schema.Struct({
  action: Schema.Literals(["replace", "insert_after", "insert_before", "delete"]),
  startAnchor: Schema.String.annotate({
    description: "Anchor of start line (e.g. '12:e4a1')",
  }),
  endAnchor: Schema.optional(Schema.String).annotate({
    description: "Anchor of end line for multi-line replace or delete (default: same as startAnchor)",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "New content to insert or replace (anchor prefixes will be automatically stripped)",
  }),
})

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The path to the file to modify" }),
  operations: Schema.Array(HashlineOp).annotate({
    description: "List of hashline operations to apply",
  }),
})

export const HashlineEditTool = Tool.define(
  "hashline_edit",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)

          yield* assertWriteAllowed(ctx, filePath)
          SandboxPathGuard.assertPathAllowed(filePath, { mode: "workspace-write", workspaceRoot: instance.worktree }, true)

          const existed = yield* afs.existsSafe(filePath)
          if (!existed) {
            throw new Error(`File not found: ${params.filePath}`)
          }

          const source = yield* Bom.readFile(afs, filePath)
          const contentOld = source.text
          let fileLines = contentOld.split("\n")

          // Sort operations bottom-up if line numbers decrease so indices stay stable
          const parsedOps = params.operations.map((op) => ({
            ...op,
            cleanContent: op.content ? stripAnchorPrefixes(op.content) : "",
          }))
          parsedOps.sort((a, b) => {
            try {
              return parseAnchor(b.startAnchor).line - parseAnchor(a.startAnchor).line
            } catch {
              return 0
            }
          })

          // Execute each operation
          for (const op of parsedOps) {
            const startIdx = findShifted(op.startAnchor, fileLines)
            const endIdx = op.endAnchor ? findShifted(op.endAnchor, fileLines) : startIdx

            if (startIdx > endIdx) {
              throw new Error(`startAnchor must precede endAnchor: "${op.startAnchor}" vs "${op.endAnchor}"`)
            }

            const replacementLines = op.cleanContent ? op.cleanContent.split("\n") : []

            switch (op.action) {
              case "replace": {
                fileLines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines)
                break
              }
              case "insert_after": {
                fileLines.splice(endIdx + 1, 0, ...replacementLines)
                break
              }
              case "insert_before": {
                fileLines.splice(startIdx, 0, ...replacementLines)
                break
              }
              case "delete": {
                fileLines.splice(startIdx, endIdx - startIdx + 1)
                break
              }
            }
          }

          let contentNew = fileLines.join("\n")
          const diff = createTwoFilesPatch(filePath, filePath, contentOld, contentNew)

          yield* askEditUnlessMemory(ctx, filePath, {
            patterns: [path.relative(instance.worktree, filePath)],
            diff,
          })

          yield* afs.writeWithDirs(filePath, Bom.join(contentNew, source.bom))
          if (yield* format.file(filePath)) {
            contentNew = yield* Bom.syncFile(afs, filePath, source.bom)
          }

          yield* bus.publish(File.Event.Edited, { file: filePath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: filePath,
            event: "change",
          })

          let additions = 0
          let deletions = 0
          for (const change of diffLines(contentOld, contentNew)) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }

          const filediff: Snapshot.FileDiff = {
            file: filePath,
            patch: diff,
            additions,
            deletions,
          }

          yield* ctx.metadata({
            metadata: { diff, filediff, diagnostics: {} },
          })

          yield* lsp.touchFile(filePath, "document")
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilePath = AppFileSystem.normalizePath(filePath)
          const block = LSP.Diagnostic.report(filePath, diagnostics[normalizedFilePath] ?? [])

          let output = `Hashline edit applied successfully (${params.operations.length} operations).`
          if (block) output += `\n\nLSP errors detected in this file, please fix:\n${block}`

          return {
            title: `${path.relative(instance.worktree, filePath)}`,
            output,
            metadata: { diff, filediff, diagnostics },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
