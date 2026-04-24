import z from "zod"
import { Tool } from "./tool"

/**
 * BriefTool — Generate a concise task brief from a description and context.
 *
 * Use this to create structured task specs that can be handed to subagents.
 * The brief standardizes the task into a clear, actionable format.
 */
export const BriefTool = Tool.define("brief", {
  description: `Generate a structured task brief from a description and optional context.

A brief is a concise, structured document that specifies:
- What needs to be done (objective)
- What constraints apply (scope, limits)
- What success looks like (acceptance criteria)
- What context is available (background)

Use briefs to create clear instructions before spawning subagents.`,

  parameters: z.object({
    task: z.string().describe("High-level description of the task to brief"),
    context: z.string().optional().describe("Additional context, constraints, or background"),
    format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
    subagent: z.string().optional().describe("Target subagent type this brief is for"),
  }),

  async execute(params, _ctx) {
    const now = new Date().toISOString()

    if (params.format === "json") {
      const brief = {
        id: `brief-${Date.now()}`,
        createdAt: now,
        task: params.task,
        context: params.context ?? null,
        targetAgent: params.subagent ?? null,
        objective: params.task,
        acceptanceCriteria: [
          "Task is completed as described",
          "No regressions introduced",
          "Changes are minimal and focused",
        ],
      }
      return {
        title: "Task Brief",
        metadata: {},
        output: JSON.stringify(brief, null, 2),
      }
    }

    const lines = [
      `# Task Brief`,
      `*Generated: ${now}*`,
      params.subagent ? `*Target: ${params.subagent} agent*` : "",
      ``,
      `## Objective`,
      params.task,
      ``,
      ...(params.context
        ? [
            `## Context`,
            params.context,
            ``,
          ]
        : []),
      `## Acceptance Criteria`,
      `- [ ] Task is completed as described above`,
      `- [ ] Output is focused — no unnecessary changes`,
      `- [ ] Any new code follows existing patterns in the codebase`,
      ``,
      `## Notes`,
      `- Work incrementally`,
      `- Ask if requirements are unclear`,
      `- Report blockers immediately`,
    ].filter((l) => l !== null)

    return {
      title: "Task Brief",
      metadata: {},
      output: lines.join("\n"),
    }
  },
})

/**
 * VerifyPlanExecutionTool — Check whether a plan was executed as specified.
 *
 * Uses the original plan and the list of completed tasks to verify
 * that all plan steps were addressed and no scope creep occurred.
 */
export const VerifyPlanExecutionTool = Tool.define("verify_plan", {
  description: `Verify that a plan was executed correctly by checking completed work against the original plan.

Use this after implementing a plan to:
- Ensure all required steps were completed
- Detect unplanned changes (scope creep)
- Generate a verification report
- Confirm the implementation meets the spec`,

  parameters: z.object({
    plan: z.string().describe("The original plan or requirements document"),
    implementation_summary: z.string().describe("Summary of what was actually implemented"),
    files_changed: z.array(z.string()).optional().describe("List of files that were changed"),
    strict: z.boolean().default(false).describe("If true, any deviation is a failure. If false, minor variations are acceptable."),
  }),

  async execute(params, _ctx) {
    // Extract plan items using simple heuristics
    const planLines = params.plan.split("\n")
    const planItems = planLines.filter((l) => {
      const trimmed = l.trim()
      return (
        trimmed.startsWith("- ") ||
        trimmed.startsWith("* ") ||
        trimmed.match(/^\d+\./) ||
        trimmed.startsWith("[ ]") ||
        trimmed.startsWith("[x]")
      )
    })

    const summary = params.implementation_summary.toLowerCase()

    // Check each plan item for evidence in the implementation summary
    const results = planItems.map((item) => {
      const text = item.replace(/^[-*\d.[\]x ]+/, "").trim().toLowerCase()
      const keywords = text.split(/\s+/).filter((w) => w.length > 4)
      const found = keywords.some((kw) => summary.includes(kw))
      return { item: item.trim(), covered: found }
    })

    const total = results.length
    const covered = results.filter((r) => r.covered).length
    const uncovered = results.filter((r) => !r.covered)
    const coverage = total > 0 ? Math.round((covered / total) * 100) : 100

    const passed = params.strict ? coverage === 100 : coverage >= 80

    const report = [
      `## Plan Verification Report`,
      ``,
      `**Coverage**: ${coverage}% (${covered}/${total} items)`,
      `**Status**: ${passed ? "✅ PASSED" : "❌ FAILED"}`,
      ``,
      ...(params.files_changed
        ? [`**Files changed**: ${params.files_changed.length}`, ...params.files_changed.map((f) => `  - ${f}`), ``]
        : []),
      `### Plan Items`,
      ...results.map((r) => `${r.covered ? "✅" : "❌"} ${r.item}`),
      ``,
      ...(uncovered.length > 0
        ? [
            `### ⚠️ Possibly Uncovered Items`,
            ...uncovered.map((r) => `- ${r.item}`),
            ``,
            `*These items had no matching keywords in the implementation summary.*`,
            `*Review manually to confirm whether they were addressed.*`,
          ]
        : ["*All plan items appear to have been addressed.*"]),
    ]

    return {
      title: `Plan Verification: ${passed ? "PASSED" : "FAILED"}`,
      metadata: {},
      output: report.join("\n"),
    }
  },
})
