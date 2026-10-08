import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import fs from "fs"
import os from "os"
import path from "path"
import DESCRIPTION from "./trash.txt"

const log = Log.create({ service: "tool.trash" })

export const Parameters = Schema.Struct({
  paths: Schema.Array(Schema.String).annotate({
    description: "Array of file or directory paths to move to the system Trash",
  }),
  allowMissing: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to ignore paths that do not exist (default: false)",
  }),
})

function getTrashDir(): string {
  const home = os.homedir()
  if (process.platform === "darwin") {
    return path.join(home, ".Trash")
  }
  if (process.platform === "win32") {
    return path.join(home, ".Trash")
  }
  return path.join(home, ".local", "share", "Trash", "files")
}

function uniqueDestPathSync(trashDir: string, originalName: string): string {
  const base = path.basename(originalName)
  const ext = path.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base

  let candidate = path.join(trashDir, base)
  if (!fs.existsSync(candidate)) {
    return candidate
  }

  const nonce = Date.now()
  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    candidate = path.join(trashDir, `${stem}-${nonce}-${attempt}${ext}`)
    if (!fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(`Unable to find free Trash destination for ${base}`)
}

function moveSync(sourcePath: string, destinationPath: string): void {
  try {
    fs.renameSync(sourcePath, destinationPath)
  } catch {
    const stats = fs.lstatSync(sourcePath)
    fs.cpSync(sourcePath, destinationPath, { recursive: stats.isDirectory(), errorOnExist: true })
    fs.rmSync(sourcePath, { recursive: stats.isDirectory(), force: true })
  }
}

export const TrashTool = Tool.define(
  "trash",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context

          yield* ctx.ask({
            permission: "trash",
            patterns: params.paths,
            always: [],
            metadata: { paths: params.paths },
          })

          const trashDir = getTrashDir()
          if (!fs.existsSync(trashDir)) {
            fs.mkdirSync(trashDir, { recursive: true })
          }

          const moved: string[] = []
          const missing: string[] = []
          const errors: string[] = []

          for (const rawPath of params.paths) {
            const trimmed = rawPath.trim()
            if (!trimmed) continue

            const absPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(instance.directory, trimmed)

            if (!fs.existsSync(absPath)) {
              if (!params.allowMissing) {
                missing.push(trimmed)
              }
              continue
            }

            try {
              const dest = uniqueDestPathSync(trashDir, absPath)
              moveSync(absPath, dest)
              moved.push(trimmed)
              log.info("moved file to trash", { source: trimmed, dest })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              errors.push(`${trimmed}: ${msg}`)
              log.error("failed to trash file", { source: trimmed, error: msg })
            }
          }

          const lines: string[] = []
          if (moved.length > 0) {
            lines.push(`✅ Moved ${moved.length} item(s) to system Trash:`)
            moved.forEach((p) => lines.push(`  - \`${p}\``))
          }
          if (missing.length > 0) {
            lines.push(`⚠️ Not found (${missing.length} items):`)
            missing.forEach((p) => lines.push(`  - \`${p}\``))
          }
          if (errors.length > 0) {
            lines.push(`❌ Failed to move (${errors.length} errors):`)
            errors.forEach((e) => lines.push(`  - ${e}`))
          }

          return {
            title: `Moved ${moved.length} item(s) to Trash`,
            output: lines.join("\n"),
            metadata: { moved, missing, errors },
          }
        }),
    }
  }),
)
