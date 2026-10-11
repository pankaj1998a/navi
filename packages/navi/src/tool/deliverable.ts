/**
 * Formal Deliverables Subsystem
 * Ported from DeepSeek Harness (packages/deliverables/tool-present & workspace-changes).
 *
 * Tracks and presents formal user-facing deliverables (code, artifacts, reports)
 * with git delta metrics (+added/-deleted lines).
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
const DESCRIPTION = "Presents and registers deliverables (code, artifacts, reports) with git delta metrics."

const log = Log.create({ service: "tool.deliverable" })

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Path to the delivered file (e.g. 'src/component/Header.tsx', 'dist/bundle.js', 'docs/API.md')",
  }),
  description: Schema.String.annotate({
    description: "Detailed description of what this deliverable achieves and its key changes",
  }),
  kind: Schema.optional(
    Schema.Literals(["code", "artifact", "report", "patch", "document"]).annotate({
      description: "Category of the deliverable (default: 'code')",
    }),
  ),
})

export interface DeliverableRecord {
  id: string
  path: string
  displayPath: string
  description: string
  kind: string
  timestamp: string
  bytes: number
  gitStats?: {
    added: number
    deleted: number
    modifiedFiles: number
  }
}

function getDeliverablesDir(rootDir: string): string {
  const dir = path.join(rootDir, ".navi", "state", "deliverables")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function loadDeliverables(rootDir: string): DeliverableRecord[] {
  const file = path.join(getDeliverablesDir(rootDir), "index.json")
  if (!fs.existsSync(file)) return []
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as DeliverableRecord[]
  } catch {
    return []
  }
}

function saveDeliverables(rootDir: string, records: DeliverableRecord[]): void {
  const file = path.join(getDeliverablesDir(rootDir), "index.json")
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), "utf-8")
  fs.renameSync(tmp, file)
}

import { execSync } from "node:child_process"

function getGitWorkspaceChanges(cwd: string): { added: number; deleted: number; modifiedFiles: number } {
  try {
    const stdout = execSync("git diff --shortstat HEAD", { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
    const filesMatch = stdout.match(/(\d+)\s+file/)
    const insertMatch = stdout.match(/(\d+)\s+insertion/)
    const deleteMatch = stdout.match(/(\d+)\s+deletion/)

    return {
      modifiedFiles: filesMatch ? parseInt(filesMatch[1]!, 10) : 0,
      added: insertMatch ? parseInt(insertMatch[1]!, 10) : 0,
      deleted: deleteMatch ? parseInt(deleteMatch[1]!, 10) : 0,
    }
  } catch {
    return { added: 0, deleted: 0, modifiedFiles: 0 }
  }
}

export const DeliverableTool = Tool.define(
  "present_deliverable",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const rootDir = instance.directory
          const targetAbs = path.isAbsolute(params.path) ? params.path : path.resolve(rootDir, params.path)

          if (!fs.existsSync(targetAbs)) {
            throw new Error(`Deliverable file does not exist at: ${params.path}`)
          }

          const stats = fs.statSync(targetAbs)
          const relPath = path.relative(rootDir, targetAbs)
          const gitStats = getGitWorkspaceChanges(rootDir)

          const record: DeliverableRecord = {
            id: `deliv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            path: targetAbs,
            displayPath: relPath,
            description: params.description,
            kind: params.kind ?? "code",
            timestamp: new Date().toISOString(),
            bytes: stats.size,
            gitStats,
          }

          const list = loadDeliverables(rootDir)
          list.unshift(record)
          saveDeliverables(rootDir, list)

          log.info("Registered deliverable", { id: record.id, path: relPath })

          return {
            title: `Delivered: ${relPath}`,
            output: [
              `📦 **Deliverable Presented**`,
              `- **File**: \`${relPath}\``,
              `- **Kind**: \`${record.kind}\``,
              `- **Size**: ${(record.bytes / 1024).toFixed(2)} KB`,
              `- **Description**: ${record.description}`,
              gitStats.modifiedFiles > 0
                ? `- **Workspace Delta**: ${gitStats.modifiedFiles} files touched (+${gitStats.added} / -${gitStats.deleted} lines)`
                : "",
              "",
              `Deliverable registered successfully in session deliverables registry.`,
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: { deliverable: record } as Record<string, unknown>,
          }
        }),
    }
  }),
)
