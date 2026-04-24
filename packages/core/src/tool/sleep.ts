import z from "zod"
import { Tool } from "./tool"

/**
 * SleepTool — Pause execution for a specified duration.
 *
 * Allows agents to:
 *  - Wait for background processes to finish
 *  - Introduce deliberate pacing between operations
 *  - Retry polling loops without hammering resources
 */
export const SleepTool = Tool.define("sleep", {
  description:
    "Pause execution for a specified number of milliseconds. Use this to wait for background processes, " +
    "introduce delays between retries, or pace long-running agentic workflows. " +
    "Maximum sleep duration is 60 seconds (60000 ms).",
  parameters: z.object({
    ms: z
      .number()
      .int()
      .min(1)
      .max(60_000)
      .describe("Duration to sleep in milliseconds (1–60000)"),
    reason: z
      .string()
      .optional()
      .describe("Optional explanation of why the sleep is needed (shown in the UI)"),
  }),
  async execute(params, ctx) {
    const ms = Math.min(params.ms, 60_000)
    const reason = params.reason ?? "Waiting..."

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      ctx.abort.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          reject(new Error("Sleep aborted by user"))
        },
        { once: true },
      )
    })

    return {
      title: `Slept ${ms}ms`,
      metadata: { ms, reason },
      output: `Slept for ${ms}ms. ${reason}`,
    }
  },
})
