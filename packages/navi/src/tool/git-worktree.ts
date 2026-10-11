/**
 * Git Worktree Isolation Tool
 * Ported from Claude Code's EnterWorktreeTool and ExitWorktreeTool.
 *
 * Provides safe sandboxing by isolating speculative edits and multi-step tasks
 * in dedicated Git worktrees.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
const DESCRIPTION = "Manages isolated Git worktrees for non-destructive branch experimentation."

const log = Log.create({ service: "tool.git-worktree" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["enter", "exit", "list"]).annotate({
    description: "Action to perform: 'enter' (create/switch into worktree), 'exit' (return to main tree), or 'list'",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Slug or task name for the worktree (e.g. 'auth-refactor', 'test-sandbox'). Used with 'enter'",
  }),
  exit_action: Schema.optional(Schema.Literals(["keep", "remove"])).annotate({
    description: "When exiting: 'keep' leaves worktree and branch on disk; 'remove' deletes them (default: 'keep')",
  }),
  discard_changes: Schema.optional(Schema.Boolean).annotate({
    description: "Required 'true' if exit_action is 'remove' and the worktree has uncommitted modifications",
  }),
})

interface ActiveWorktreeSession {
  name: string
  originalCwd: string
  worktreePath: string
  branch: string
  createdAt: string
}

function getWorktreeStateFile(baseDir: string): string {
  const dir = path.join(baseDir, ".navi", "state", "worktrees")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return path.join(dir, "active.json")
}

function getActiveSession(baseDir: string): ActiveWorktreeSession | null {
  const file = getWorktreeStateFile(baseDir)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ActiveWorktreeSession
  } catch {
    return null
  }
}

function saveActiveSession(baseDir: string, session: ActiveWorktreeSession | null): void {
  const file = getWorktreeStateFile(baseDir)
  if (!session) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return
  }
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), "utf-8")
  fs.renameSync(tmp, file)
}

import { spawnSync } from "node:child_process"

function runGit(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
  const proc = spawnSync("git", args, { cwd, encoding: "utf-8" })
  return {
    code: proc.status ?? 1,
    stdout: (proc.stdout || "").trim(),
    stderr: (proc.stderr || "").trim(),
  }
}

export const GitWorktreeTool = Tool.define(
  "git_worktree",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const rootDir = instance.directory

          // Check if git repo
          const checkGit = runGit(["rev-parse", "--is-inside-work-tree"], rootDir)
          if (checkGit.code !== 0) {
            throw new Error("Working directory is not inside a Git repository")
          }

      switch (params.action) {
        case "enter": {
          const current = getActiveSession(rootDir)
          if (current) {
            return {
              title: "Already in Worktree",
              output: `Already in an active worktree session: **${current.name}** at \`${current.worktreePath}\` (branch \`${current.branch}\`). Use \`git_worktree\` with \`action: 'exit'\` first.`,
              metadata: { active: current },
            }
          }

          const rawSlug = params.name ?? `sandbox-${Date.now().toString(36)}`
          const slug = rawSlug.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()
          const worktreePath = path.resolve(path.join(rootDir, ".navi", "worktrees", slug))
          const branch = `navi/wt/${slug}`

          // Ensure worktrees parent dir exists
          const parentDir = path.dirname(worktreePath)
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true })
          }

          // Create git worktree
          const addRes = runGit(["worktree", "add", "-b", branch, worktreePath, "HEAD"], rootDir)
          if (addRes.code !== 0) {
            throw new Error(`Failed to create worktree: ${addRes.stderr || addRes.stdout}`)
          }

          const session: ActiveWorktreeSession = {
            name: slug,
            originalCwd: rootDir,
            worktreePath,
            branch,
            createdAt: new Date().toISOString(),
          }
          saveActiveSession(rootDir, session)

          log.info("Entered git worktree", { slug, worktreePath, branch })

          return {
            title: `Entered Worktree ${slug}`,
            output: [
              `🌿 **Git Isolation Active**`,
              `- **Worktree**: \`${worktreePath}\``,
              `- **Branch**: \`${branch}\``,
              `- **Created**: ${new Date(session.createdAt).toLocaleTimeString()}`,
              "",
              `Experimental changes in this worktree will not affect the main repository.`,
              `When finished, call \`git_worktree\` with \`action: "exit"\` and \`exit_action: "keep"\` or \`"remove"\`.`,
            ].join("\n"),
            metadata: { session } as Record<string, unknown>,
          }
        }

        case "exit": {
          const active = getActiveSession(rootDir)
          if (!active) {
            return {
              title: "No Active Worktree",
              output: "No active Git worktree session was recorded. Nothing to exit.",
              metadata: { active: null },
            }
          }

          const exitAction = params.exit_action ?? "keep"

          if (exitAction === "remove") {
            // Check dirty status in worktree
            const status = runGit(["status", "--porcelain"], active.worktreePath)
            const dirty = status.stdout.length > 0

            if (dirty && !params.discard_changes) {
              return {
                title: "Worktree Has Uncommitted Changes",
                output: [
                  `⚠️ **Worktree has uncommitted modifications:**`,
                  "```",
                  status.stdout,
                  "```",
                  `Removing the worktree will permanently discard these changes.`,
                  `To proceed with removal, call \`git_worktree\` with \`action: "exit"\`, \`exit_action: "remove"\`, and \`discard_changes: true\`.`,
                  `Alternatively, use \`exit_action: "keep"\` to preserve your work.`,
                ].join("\n"),
                metadata: { dirty: true } as Record<string, unknown>,
              }
            }

            // Remove worktree
            runGit(["worktree", "remove", "--force", active.worktreePath], rootDir)
            // Delete branch
            runGit(["branch", "-D", active.branch], rootDir)
            saveActiveSession(rootDir, null)

            log.info("Removed git worktree", { name: active.name })
            return {
              title: `Exited and Removed Worktree ${active.name}`,
              output: `🧹 Worktree \`${active.worktreePath}\` and branch \`${active.branch}\` removed. Session returned to root \`${rootDir}\`.`,
              metadata: { action: "removed", slug: active.name } as Record<string, unknown>,
            }
          }

          // exitAction === "keep"
          saveActiveSession(rootDir, null)
          log.info("Exited and kept git worktree", { name: active.name })
          return {
            title: `Exited Worktree ${active.name}`,
            output: `💾 Exited worktree. Files and branch \`${active.branch}\` preserved at \`${active.worktreePath}\`. Session returned to root \`${rootDir}\`.`,
            metadata: { action: "kept", slug: active.name } as Record<string, unknown>,
          }
        }

        case "list": {
          const active = getActiveSession(rootDir)
          const listRes = runGit(["worktree", "list"], rootDir)

          return {
            title: "Git Worktrees",
            output: [
              active ? `Active Session Worktree: **${active.name}** (\`${active.worktreePath}\` on \`${active.branch}\`)\n` : "",
              "**All Repository Worktrees:**",
              "```",
              listRes.stdout || "(none)",
              "```",
            ].join("\n"),
            metadata: { active, all: listRes.stdout } as Record<string, unknown>,
          }
        }

        default:
          throw new Error(`Unknown git_worktree action: ${params.action}`)
      }
    }),
    }
  }),
)

