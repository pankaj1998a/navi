import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
import DESCRIPTION from "./checkpoint.txt"

const log = Log.create({ service: "tool.checkpoint" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["create", "list", "restore", "drop"]).annotate({
    description: "The checkpoint action to perform: 'create', 'list', 'restore', or 'drop'",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Descriptive name for the checkpoint (e.g. 'before-auth-refactor', 'pre-migration')",
  }),
  id: Schema.optional(Schema.String).annotate({
    description: "Checkpoint ID to restore or drop (e.g. 'cp-1725000000-abc')",
  }),
})

type CheckpointEntry = {
  id: string
  name: string
  createdAt: string
  patchFile: string
}

function getCheckpointDir(worktree: string): string {
  const dir = path.join(worktree, ".navi", "state", "checkpoints")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getIndexFile(worktree: string): string {
  return path.join(getCheckpointDir(worktree), "index.json")
}

function loadCheckpoints(worktree: string): CheckpointEntry[] {
  const file = getIndexFile(worktree)
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8")) as CheckpointEntry[]
    } catch {
      return []
    }
  }
  return []
}

function saveCheckpoints(worktree: string, list: CheckpointEntry[]): void {
  const file = getIndexFile(worktree)
  fs.writeFileSync(file, JSON.stringify(list, null, 2), "utf-8")
}

export const CheckpointTool = Tool.define(
  "checkpoint",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cpDir = getCheckpointDir(instance.directory)

          yield* ctx.ask({
            permission: "checkpoint",
            patterns: [params.action, params.id ?? params.name ?? "*"],
            always: ["*"],
            metadata: {
              action: params.action,
              name: params.name,
              id: params.id,
            },
          })

          switch (params.action) {
            case "create": {
              const name = params.name || "manual-checkpoint"
              const id = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
              const patchFile = `${id}.patch`
              const patchPath = path.join(cpDir, patchFile)

              // Capture git diff HEAD
              const diffResult = yield* Effect.promise(async () => {
                try {
                  const proc = Bun.spawn(["git", "diff", "HEAD"], {
                    cwd: instance.directory,
                    stdout: "pipe",
                    stderr: "pipe",
                  })
                  return await new Response(proc.stdout).text()
                } catch {
                  return ""
                }
              })

              fs.writeFileSync(patchPath, diffResult, "utf-8")

              const list = loadCheckpoints(instance.directory)
              const entry: CheckpointEntry = {
                id,
                name,
                createdAt: new Date().toISOString(),
                patchFile,
              }
              list.unshift(entry)
              saveCheckpoints(instance.directory, list)

              return {
                title: `Created checkpoint ${id}`,
                output: [
                  `🛡️ **Safety Checkpoint Created**`,
                  `- **ID**: \`${id}\``,
                  `- **Name**: ${name}`,
                  `- **Timestamp**: ${new Date(entry.createdAt).toLocaleString()}`,
                  `- **Saved to**: \`.navi/state/checkpoints/${patchFile}\``,
                  "",
                  `You can restore this state anytime using \`checkpoint\` with \`action: "restore"\` and \`id: "${id}"\`.`,
                ].join("\n"),
                metadata: { action: "create", id, name } as Record<string, unknown>,
              }
            }

            case "list": {
              const list = loadCheckpoints(instance.directory)
              if (list.length === 0) {
                return {
                  title: "Checkpoints (0)",
                  output: "No checkpoints recorded yet. Use `checkpoint` with `action: 'create'` to save one.",
                  metadata: { count: 0 } as Record<string, unknown>,
                }
              }

              const formatted = list
                .map(
                  (c) =>
                    `- **${c.name}** (\`${c.id}\`)\n  Created: ${new Date(c.createdAt).toLocaleString()}`,
                )
                .join("\n")

              return {
                title: `Checkpoints (${list.length})`,
                output: `### Saved Safety Checkpoints\n\n${formatted}`,
                metadata: { count: list.length } as Record<string, unknown>,
              }
            }

            case "restore": {
              if (!params.id && !params.name) {
                throw new Error("Either 'id' or 'name' is required for action 'restore'")
              }

              const list = loadCheckpoints(instance.directory)
              const target = list.find((c) => c.id === params.id || c.name === params.name)
              if (!target) {
                throw new Error(`Checkpoint not found for id/name: "${params.id || params.name}"`)
              }

              const patchPath = path.join(cpDir, target.patchFile)

              // 1. Reset working directory with git checkout .
              yield* Effect.promise(async () => {
                const cleanProc = Bun.spawn(["git", "checkout", "."], {
                  cwd: instance.directory,
                  stdout: "pipe",
                  stderr: "pipe",
                })
                await cleanProc.exited

                if (fs.existsSync(patchPath)) {
                  const patchContent = fs.readFileSync(patchPath, "utf-8")
                  if (patchContent.trim().length > 0) {
                    const applyProc = Bun.spawn(["git", "apply", "--whitespace=nowarn", patchPath], {
                      cwd: instance.directory,
                      stdout: "pipe",
                      stderr: "pipe",
                    })
                    await applyProc.exited
                  }
                }
              })

              return {
                title: `Restored checkpoint ${target.id}`,
                output: `⏪ Working tree successfully restored to checkpoint: **${target.name}** (\`${target.id}\`).`,
                metadata: { action: "restore", id: target.id } as Record<string, unknown>,
              }
            }

            case "drop": {
              if (!params.id) throw new Error("Parameter 'id' is required for action 'drop'")
              const list = loadCheckpoints(instance.directory)
              const filtered = list.filter((c) => c.id !== params.id)
              const removed = list.find((c) => c.id === params.id)

              if (removed) {
                const patchPath = path.join(cpDir, removed.patchFile)
                if (fs.existsSync(patchPath)) {
                  fs.unlinkSync(patchPath)
                }
              }

              saveCheckpoints(instance.directory, filtered)

              return {
                title: `Dropped checkpoint ${params.id}`,
                output: `🗑️ Checkpoint \`${params.id}\` deleted.`,
                metadata: { action: "drop", id: params.id } as Record<string, unknown>,
              }
            }

            default:
              throw new Error(`Unknown checkpoint action: ${params.action}`)
          }
        }),
    }
  }),
)
