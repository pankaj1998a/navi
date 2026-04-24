import z from "zod"
import { Tool } from "./tool"
import { CronScheduler } from "../scheduler/runner"
import { cronToHuman, isValidCron } from "../scheduler/cron"

/**
 * ScheduleCronTool — Let the AI schedule recurring commands via cron expressions.
 */
export const ScheduleCronTool = Tool.define("schedule_cron", {
  description: `Schedule recurring commands using cron expressions. Use this to automate tasks that should run on a time schedule.

Operations:
- **add**: Register a new recurring job with a cron expression
- **list**: Show all scheduled jobs with their status
- **remove**: Permanently delete a scheduled job
- **enable**: Re-enable a paused job
- **disable**: Pause a job without deleting it
- **run**: Execute a job immediately regardless of schedule

Cron expression format: "minute hour day-of-month month day-of-week"
Examples:
  "0 9 * * 1-5"  → Weekdays at 9am
  "*/15 * * * *" → Every 15 minutes
  "0 0 * * *"    → Every day at midnight`,

  parameters: z.object({
    operation: z.enum(["add", "list", "remove", "enable", "disable", "run"])
      .describe("Operation to perform"),
    name: z.string().optional().describe("Short name for this job (required for 'add')"),
    description: z.string().optional().describe("What this job does (required for 'add')"),
    expression: z.string().optional().describe("5-field cron expression, e.g. '0 9 * * 1-5' (required for 'add')"),
    command: z.string().optional().describe("Shell command to execute (required for 'add')"),
    id: z.string().optional().describe("Job ID (required for remove/enable/disable/run)"),
  }),

  async execute(params, _ctx) {
    const op = params.operation

    if (op === "add") {
      if (!params.name || !params.description || !params.expression || !params.command) {
        throw new Error("add operation requires: name, description, expression, command")
      }
      if (!isValidCron(params.expression)) {
        throw new Error(`Invalid cron expression: "${params.expression}". Expected 5-field format like "0 9 * * 1-5".`)
      }
      const job = await CronScheduler.add({
        name: params.name,
        description: params.description,
        expression: params.expression,
        command: params.command,
      })
      const human = cronToHuman(params.expression)
      return {
        title: `Scheduled: ${params.name}`,
        metadata: {},
        output: [
          `✅ Cron job created successfully.`,
          ``,
          `**ID**: ${job.id}`,
          `**Name**: ${job.name}`,
          `**Schedule**: ${human} (\`${params.expression}\`)`,
          `**Command**: \`${params.command}\``,
          `**Next run**: ${job.nextRun ? new Date(job.nextRun).toLocaleString() : "N/A"}`,
        ].join("\n"),
      }
    }

    if (op === "list") {
      const summary = CronScheduler.summary()
      return {
        title: "Cron Jobs",
        metadata: {},
        output: summary,
      }
    }

    if (!params.id) {
      throw new Error(`Operation "${op}" requires an id`)
    }

    if (op === "remove") {
      await CronScheduler.remove(params.id)
      return {
        title: `Removed job ${params.id}`,
        metadata: {},
        output: `✅ Cron job ${params.id} has been permanently removed.`,
      }
    }

    if (op === "enable") {
      const job = await CronScheduler.setEnabled(params.id, true)
      return {
        title: `Enabled: ${job.name}`,
        metadata: {},
        output: `✅ Cron job "${job.name}" enabled. Next run: ${job.nextRun ? new Date(job.nextRun).toLocaleString() : "N/A"}`,
      }
    }

    if (op === "disable") {
      const job = await CronScheduler.setEnabled(params.id, false)
      return {
        title: `Disabled: ${job.name}`,
        metadata: {},
        output: `⏸️ Cron job "${job.name}" has been paused.`,
      }
    }

    // run
    const job = CronScheduler.get(params.id)
    if (!job) throw new Error(`Cron job not found: ${params.id}`)
    await CronScheduler.runNow(params.id)
    return {
      title: `Ran: ${job.name}`,
      metadata: {},
      output: `✅ Cron job "${job.name}" executed immediately.`,
    }
  },
})
