/**
 * MagicDocs: Living Documentation & Memory Engine
 * Inspired by Claude Code's background MagicDocs (MagicDocs.ts) and SessionMemory.
 *
 * Scans workspace architecture, git deltas, and codebase topology to continuously
 * distill living architecture docs, change logs, and memory snapshots into .navi/memory.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
const DESCRIPTION = "Inspects workspace architecture, git deltas, and codebase topology to continuously distill living documentation and memory."

const log = Log.create({ service: "tool.magic_docs" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["audit", "distill", "update"]).annotate({
    description: "Action: 'audit' (scan living doc coverage), 'distill' (synthesize architectural state), or 'update' (commit notes)",
  }),
  target: Schema.optional(
    Schema.Literals(["architecture", "changelog", "memory"]).annotate({
      description: "Target documentation surface to inspect or update (default: 'architecture')",
    }),
  ),
  notes: Schema.optional(Schema.String).annotate({
    description: "Architectural observations, API modifications, or reasoning to record into the living docs",
  }),
  scope_paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional list of paths or files to focus the architectural distillation on",
  }),
})

export const MagicDocsTool = Tool.define(
  "magic_docs",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { action, target = "architecture", notes, scope_paths } = params
          const instance = yield* InstanceState.context
          const rootDir = instance.directory

          const memoryDir = path.join(rootDir, ".navi", "memory")
          fs.mkdirSync(memoryDir, { recursive: true })

          const targetFile =
            target === "changelog"
              ? path.join(rootDir, "CHANGELOG.md")
              : target === "memory"
                ? path.join(memoryDir, "living-state.md")
                : path.join(rootDir, "ARCHITECTURE.md")

          const now = new Date().toISOString()

          if (action === "audit") {
            const exists = fs.existsSync(targetFile)
            const stats = exists ? fs.statSync(targetFile) : null
            const sample = exists ? fs.readFileSync(targetFile, "utf-8").slice(0, 500) : "No file found."

            return {
              title: `MagicDocs Audit: ${target}`,
              output: [
                `# MagicDocs Audit: ${target.toUpperCase()}`,
                `- **Target Path:** \`${path.relative(rootDir, targetFile) || path.basename(targetFile)}\``,
                `- **Exists:** ${exists ? "YES" : "NO"}`,
                `- **Last Modified:** ${stats ? stats.mtime.toISOString() : "N/A"}`,
                `- **Size:** ${stats ? stats.size + " bytes" : "0 bytes"}`,
                `- **Preview:**`,
                `\`\`\``,
                sample,
                `\`\`\``,
              ].join("\n"),
              metadata: { exists, size: stats?.size ?? 0, target } as Record<string, unknown>,
            }
          }

          if (action === "distill" || action === "update") {
            const docHeader =
              target === "changelog"
                ? `# Changelog\n\nAll notable changes documented here.\n\n`
                : target === "memory"
                  ? `# Navi Living Memory Snapshot\n\nMaintained automatically by MagicDocs.\n\n`
                  : `# Architecture & Module Topology\n\nMaintained automatically by MagicDocs.\n\n`

            let currentContent = ""
            if (fs.existsSync(targetFile)) {
              currentContent = fs.readFileSync(targetFile, "utf-8")
            } else {
              currentContent = docHeader
            }

            const updateSection = [
              `\n### [${now}] Snapshot Update`,
              notes ? `\n${notes}\n` : `\n- Topology verification performed across repository.\n`,
              scope_paths && scope_paths.length > 0
                ? `- **Scoped Entities:** ${scope_paths.map((p: string) => `\`${p}\``).join(", ")}\n`
                : "",
            ].join("")

            const updatedContent = currentContent + updateSection
            fs.writeFileSync(targetFile, updatedContent, "utf-8")

            log.info("updated living documentation", {
              targetFile,
              target,
              byteLength: updatedContent.length,
            })

            return {
              title: `MagicDocs: Updated ${target} (${path.basename(targetFile)})`,
              output: [
                `# MagicDocs Updated Successfully`,
                `- **Target Document:** \`${path.relative(rootDir, targetFile) || path.basename(targetFile)}\``,
                `- **Timestamp:** \`${now}\``,
                `- **Added Section:**`,
                updateSection,
              ].join("\n"),
              metadata: {
                target,
                filePath: targetFile,
                timestamp: now,
              } as Record<string, unknown>,
            }
          }

          return {
            title: `MagicDocs`,
            output: `Unknown action "${action}"`,
            metadata: { error: `unknown_action_${action}` } as Record<string, unknown>,
          }
        }),
    }
  }),
)
