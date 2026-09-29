import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./teleport.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["teleport", "status", "list", "resume"]).annotate({
    description: "Teleport action: teleport (migrate remote session), status, list remote sessions, resume",
  }),
  sessionId: Schema.optional(Schema.String).annotate({
    description: "Remote session ID to teleport/resume",
  }),
  target: Schema.optional(Schema.String).annotate({
    description: "Target environment/branch for teleport (e.g. env name or branch)",
  }),
})

export const TeleportTool = Tool.define(
  "teleport",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "teleport",
            patterns: [params.action, params.sessionId ?? "*"],
            always: ["status", "list"],
            metadata: { action: params.action, sessionId: params.sessionId },
          })

          switch (params.action) {
            case "status":
              return {
                title: "Teleport status",
                output: [
                  "Teleport: stub (no network)",
                  "Full flow: validating -> fetching_logs -> fetching_branch -> checking_out -> done",
                  "Requires: OAuth (getClaudeAIOAuthTokens), GitHub app check, git bundle upload (createAndUploadGitBundle)",
                  "APIs: src/utils/teleport/api.ts fetchSession, environments.ts fetchEnvironments",
                  "Last migration: none (stub)",
                ].join("\n"),
                metadata: { enabled: false, lastMigration: null } as Record<string, unknown>,
              }
            case "list":
              return {
                title: "Teleport remote sessions (stub)",
                output: [
                  "Remote sessions available for teleport (stub):",
                  "- session-abc123 (main) — 2026-04-04 — branch feat/auth",
                  "- session-def456 (dev) — 2026-04-03 — branch fix/scroll",
                  "Full impl: getSessionLogsViaOAuth + getTeleportEvents + fetchEnvironments()",
                ].join("\n"),
                metadata: { count: 2 } as Record<string, unknown>,
              }
            case "teleport": {
              if (!params.sessionId) throw new Error("Parameter 'sessionId' is required for action 'teleport'")
              return {
                title: `Teleport: ${params.sessionId}`,
                output: [
                  `Teleporting session ${params.sessionId} (stub)...`,
                  `Target: ${params.target ?? "<current workspace>"}`,
                  "Steps (stubbed): validating -> fetching_logs -> fetching_branch -> checking_out -> done",
                  "No git checkout performed. Full impl would: checkGate, validate, fetchSession, createAndUploadGitBundle, deserializeMessages, queryHaiku, checkout branch.",
                  `Session: ${ctx.sessionID} would receive teleported messages + branch ${params.target ?? "teleport/<id>"}`,
                ].join("\n"),
                metadata: { sessionId: params.sessionId, target: params.target ?? null } as Record<string, unknown>,
              }
            }
            case "resume": {
              if (!params.sessionId) throw new Error("Parameter 'sessionId' is required for action 'resume'")
              return {
                title: `Teleport resume: ${params.sessionId}`,
                output: `Resuming teleported session ${params.sessionId} (stub). Full impl would call resume via SessionMemory + conversationRecovery.deserializeMessages().`,
                metadata: { sessionId: params.sessionId } as Record<string, unknown>,
              }
            }
            default:
              throw new Error(`Unknown teleport action: ${params.action}`)
          }
        }).pipe(Effect.orDie),
    }
  }),
)
