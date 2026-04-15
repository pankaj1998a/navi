import z from "zod"
import { Tool } from "./tool"

/**
 * SyntheticOutputTool — Inject synthetic messages into the conversation.
 *
 * Allows the agent to programmatically inject context into the conversation
 * history without it appearing as a user-visible message. Used for:
 * - Providing background context midway through a task
 * - Injecting reminder prompts after long tool chains
 * - Populating context from external data sources
 */
export const SyntheticOutputTool = Tool.define("synthetic_output", {
  description: `Inject a synthetic context message into the conversation without displaying it to the user.

Use this when you need to:
- Add structured background information to your context window
- Insert reminders or constraints mid-task
- Feed external data (e.g., fetched docs, computed results) directly into context
- Signal state changes between agent turns

The injected content is processed as context, not displayed in the conversation UI.
Note: This does not create a new user message — it extends the agent's working context.`,

  parameters: z.object({
    content: z.string().describe("The synthetic context content to inject"),
    label: z.string().optional().describe("Optional label for this context block (e.g. 'API Response', 'Background Context')"),
    replace_existing: z.boolean().default(false).describe("If true, replace any previously injected synthetic context with this new content"),
  }),

  async execute(params, _ctx) {
    const label = params.label ? `[${params.label}]` : "[Injected Context]"
    // The content is returned as the tool output so the model sees it in context
    return {
      title: label,
      metadata: { synthetic: true, label: params.label },
      output: params.content,
    }
  },
})
