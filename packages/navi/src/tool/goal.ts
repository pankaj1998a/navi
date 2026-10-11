/**
 * Goal State Machine
 * Ported from DeepSeek Harness (packages/goal/goal).
 *
 * Implements structured goal lifecycle management (active, paused, blocked, complete)
 * with machine-routable block reasons and round budgeting.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
const DESCRIPTION = "Manages structured goal lifecycle (create, status, block, unblock, complete) with machine-routable block codes and round budgets."

const log = Log.create({ service: "tool.goal" })

export type GoalPhase = "active" | "paused" | "blocked" | "complete"

export interface GoalBlockReason {
  code: string
  message: string
}

export interface GoalSnapshot {
  id: string
  revision: number
  objective: string
  phase: GoalPhase
  blockedReason?: GoalBlockReason
  maxGoalRounds: number
  roundsUsed: number
  subtasks: Array<{ id: string; title: string; completed: boolean }>
  updatedAt: string
}

export const Parameters = Schema.Struct({
  action: Schema.Literals(["create", "status", "block", "unblock", "complete"]).annotate({
    description: "Action to perform on the goal: 'create', 'status', 'block', 'unblock', or 'complete'",
  }),
  objective: Schema.optional(Schema.String).annotate({
    description: "Human-requested completion objective (required for 'create')",
  }),
  block_code: Schema.optional(Schema.String).annotate({
    description: "Machine-routable lower-kebab-case code when blocking (e.g. 'user_approval_required', 'tests_failing')",
  }),
  block_message: Schema.optional(Schema.String).annotate({
    description: "Explanation shown to humans and models when goal is blocked",
  }),
  max_rounds: Schema.optional(Schema.Number).annotate({
    description: "Maximum turn budget for this goal (default: 25)",
  }),
  subtasks: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description: "List of key milestone subtasks",
    }),
  ),
})

function getGoalFile(rootDir: string): string {
  const dir = path.join(rootDir, ".navi", "state", "goals")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return path.join(dir, "active.json")
}

function loadGoal(rootDir: string): GoalSnapshot | null {
  const file = getGoalFile(rootDir)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as GoalSnapshot
  } catch {
    return null
  }
}

function saveGoal(rootDir: string, goal: GoalSnapshot | null): void {
  const file = getGoalFile(rootDir)
  if (!goal) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return
  }
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(goal, null, 2), "utf-8")
  fs.renameSync(tmp, file)
}

export const GoalTool = Tool.define(
  "goal_manage",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const rootDir = instance.directory

          switch (params.action) {
            case "create": {
              if (!params.objective) {
                throw new Error("Parameter 'objective' is required to create a goal")
              }
              const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
              const subtasks = (params.subtasks ?? []).map((t, i) => ({
                id: `st_${i + 1}`,
                title: t,
                completed: false,
              }))

              const snapshot: GoalSnapshot = {
                id,
                revision: 1,
                objective: params.objective,
                phase: "active",
                maxGoalRounds: params.max_rounds ?? 25,
                roundsUsed: 0,
                subtasks,
                updatedAt: new Date().toISOString(),
              }

              saveGoal(rootDir, snapshot)
              log.info("Created goal", { id, objective: snapshot.objective })

              return {
                title: `Created Goal: ${snapshot.objective}`,
                output: [
                  `🎯 **Goal Activated**`,
                  `- **ID**: \`${snapshot.id}\` (rev ${snapshot.revision})`,
                  `- **Objective**: ${snapshot.objective}`,
                  `- **Phase**: \`${snapshot.phase}\``,
                  `- **Turn Budget**: ${snapshot.maxGoalRounds} rounds`,
                  subtasks.length > 0 ? `- **Subtasks**: ${subtasks.map((s) => `\n  - [ ] ${s.title}`).join("")}` : "",
                  "",
                  `Goal lifecycle is active and will track progress until completed or blocked.`,
                ]
                  .filter(Boolean)
                  .join("\n"),
                metadata: { goal: snapshot } as Record<string, unknown>,
              }
            }

            case "status": {
              const current = loadGoal(rootDir)
              if (!current) {
                return {
                  title: "No Active Goal",
                  output: "No active goal is currently being tracked. Call `goal_manage` with `action: 'create'` to set one.",
                  metadata: { goal: null },
                }
              }

              const statusEmoji = current.phase === "active" ? "🟢" : current.phase === "blocked" ? "🔴" : "🏁"

              return {
                title: `Goal Status: ${current.phase}`,
                output: [
                  `🎯 **Goal State Machine Status**`,
                  `- **Objective**: ${current.objective}`,
                  `- **Phase**: ${statusEmoji} \`${current.phase}\``,
                  `- **Progress**: ${current.roundsUsed} / ${current.maxGoalRounds} rounds`,
                  current.blockedReason
                    ? `⚠️ **Blocked [${current.blockedReason.code}]**: ${current.blockedReason.message}`
                    : "",
                  current.subtasks.length > 0
                    ? `\n**Subtasks:**\n${current.subtasks.map((s) => `  - [${s.completed ? "x" : " "}] ${s.title}`).join("\n")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
                metadata: { goal: current } as Record<string, unknown>,
              }
            }

            case "block": {
              const current = loadGoal(rootDir)
              if (!current) throw new Error("No active goal to block")

              current.phase = "blocked"
              current.revision++
              current.blockedReason = {
                code: params.block_code ?? "unspecified_blocker",
                message: params.block_message ?? "Execution paused by agent blocker",
              }
              current.updatedAt = new Date().toISOString()
              saveGoal(rootDir, current)

              log.warn("Goal blocked", { id: current.id, code: current.blockedReason.code })

              return {
                title: `Goal Blocked: ${current.blockedReason.code}`,
                output: `🛑 **Goal Blocked**: \`${current.blockedReason.code}\`\n${current.blockedReason.message}\n\nCall \`goal_manage\` with \`action: 'unblock'\` once resolved.`,
                metadata: { goal: current } as Record<string, unknown>,
              }
            }

            case "unblock": {
              const current = loadGoal(rootDir)
              if (!current) throw new Error("No active goal to unblock")

              current.phase = "active"
              current.revision++
              delete current.blockedReason
              current.updatedAt = new Date().toISOString()
              saveGoal(rootDir, current)

              log.info("Goal unblocked", { id: current.id })

              return {
                title: "Goal Unblocked",
                output: `▶️ **Goal Resumed**: \`${current.objective}\` is now active.`,
                metadata: { goal: current } as Record<string, unknown>,
              }
            }

            case "complete": {
              const current = loadGoal(rootDir)
              if (!current) throw new Error("No active goal to complete")

              current.phase = "complete"
              current.revision++
              current.updatedAt = new Date().toISOString()
              saveGoal(rootDir, current)

              log.info("Goal complete", { id: current.id })

              return {
                title: "Goal Completed",
                output: `🏆 **Goal Completed!**\nObjective: **${current.objective}** achieved in ${current.roundsUsed} rounds.`,
                metadata: { goal: current } as Record<string, unknown>,
              }
            }

            default:
              throw new Error(`Unknown goal_manage action: ${params.action}`)
          }
        }),
    }
  }),
)
