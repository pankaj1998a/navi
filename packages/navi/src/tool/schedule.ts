import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as Log from "@navi-ai/core/util/log"
import { CronScheduler } from "@/scheduler/runner"
import { cronToHuman, isValidCron } from "@/scheduler/cron"
import DESCRIPTION from "./schedule.txt"

const log = Log.create({ service: "tool.schedule" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["create", "list", "remove", "run_now", "toggle"]).annotate({
    description: "The schedule action to perform: 'create', 'list', 'remove', 'run_now', or 'toggle'",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Human-readable name of the scheduled job (required for 'create')",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "Description of what this job does",
  }),
  command: Schema.optional(Schema.String).annotate({
    description: "The shell command to execute when the schedule triggers (required for 'create')",
  }),
  expression: Schema.optional(Schema.String).annotate({
    description: "Standard 5-field cron expression (e.g. '*/5 * * * *' for every 5 mins, '0 * * * *' for hourly)",
  }),
  delaySeconds: Schema.optional(Schema.Number).annotate({
    description: "One-shot delay in seconds before executing the command once",
  }),
  id: Schema.optional(Schema.String).annotate({
    description: "The job ID to remove, run now, or toggle (e.g. 'cron-123456789-abc')",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Whether the job should be enabled (for 'toggle' action)",
  }),
})

export const ScheduleTool = Tool.define(
  "schedule",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "schedule",
            patterns: [params.action, params.id ?? params.name ?? "*"],
            always: ["*"],
            metadata: {
              action: params.action,
              name: params.name,
              command: params.command,
              expression: params.expression,
            },
          })

          switch (params.action) {
            case "create": {
              if (!params.name) throw new Error("Parameter 'name' is required for action 'create'")
              if (!params.command) throw new Error("Parameter 'command' is required for action 'create'")

              let cronExpr = params.expression

              // If delaySeconds provided instead of cron expression, compute one-shot or interval expression
              if (!cronExpr && params.delaySeconds) {
                const mins = Math.max(1, Math.round(params.delaySeconds / 60))
                cronExpr = `*/${mins} * * * *`
              }

              if (!cronExpr) {
                cronExpr = "0 * * * *" // default hourly
              }

              if (!isValidCron(cronExpr)) {
                throw new Error(`Invalid cron expression: "${cronExpr}". Must be a standard 5-field cron expression.`)
              }

              const jobName = params.name
              const jobDesc = params.description ?? ""
              const jobCmd = params.command
              const finalExpr = cronExpr

              const job = yield* Effect.promise(() =>
                CronScheduler.add({
                  name: jobName,
                  description: jobDesc,
                  expression: finalExpr,
                  command: jobCmd,
                }),
              )

              const human = cronToHuman(cronExpr)

              return {
                title: `Scheduled job ${job.name}`,
                output: [
                  `✅ **Cron Job Scheduled Successfully**`,
                  `- **ID**: \`${job.id}\``,
                  `- **Name**: ${job.name}`,
                  `- **Schedule**: ${human} (\`${job.expression}\`)`,
                  `- **Command**: \`${job.command}\``,
                  `- **Next Run**: ${job.nextRun ? new Date(job.nextRun).toLocaleString() : "Pending"}`,
                ].join("\n"),
                metadata: { action: "create", jobId: job.id } as Record<string, unknown>,
              }
            }

            case "list": {
              const summary = CronScheduler.summary()
              const jobs = CronScheduler.list()

              return {
                title: `Scheduled Jobs (${jobs.length})`,
                output: summary,
                metadata: { action: "list", jobsCount: jobs.length } as Record<string, unknown>,
              }
            }

            case "remove": {
              if (!params.id) throw new Error("Parameter 'id' is required for action 'remove'")
              const targetId = params.id
              yield* Effect.promise(() => CronScheduler.remove(targetId))

              return {
                title: `Removed job ${params.id}`,
                output: `🗑️ Scheduled job \`${params.id}\` removed.`,
                metadata: { action: "remove", jobId: params.id } as Record<string, unknown>,
              }
            }

            case "run_now": {
              if (!params.id) throw new Error("Parameter 'id' is required for action 'run_now'")
              const targetId = params.id
              yield* Effect.promise(() => CronScheduler.runNow(targetId))

              return {
                title: `Triggered job ${params.id}`,
                output: `⚡ Immediately triggered run for job \`${params.id}\`.`,
                metadata: { action: "run_now", jobId: params.id } as Record<string, unknown>,
              }
            }

            case "toggle": {
              if (!params.id) throw new Error("Parameter 'id' is required for action 'toggle'")
              if (params.enabled === undefined) throw new Error("Parameter 'enabled' (boolean) is required for action 'toggle'")

              const targetId = params.id
              const isEnabled = params.enabled
              const updated = yield* Effect.promise(() => CronScheduler.setEnabled(targetId, isEnabled))

              return {
                title: `Job ${params.id} ${updated.enabled ? "enabled" : "disabled"}`,
                output: `${updated.enabled ? "✅ Enabled" : "⏸️ Disabled"} job \`${params.id}\`. Next run: ${updated.nextRun ? new Date(updated.nextRun).toLocaleString() : "None"}`,
                metadata: { action: "toggle", jobId: params.id } as Record<string, unknown>,
              }
            }

            default:
              throw new Error(`Unknown schedule action: ${params.action}`)
          }
        }),
    }
  }),
)
