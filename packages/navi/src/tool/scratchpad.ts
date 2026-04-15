import { Tool } from "./tool"
import { Session } from "../session"
import z from "zod"

/**
 * Scratchpad tool allows the agent to maintain a persistent block of notes
 * that is always visible in the system prompt.
 */
export const ScratchpadTool = Tool.define("scratchpad", {
    description: "Manage a persistent scratchpad of notes and plans. Use this to keep track of complex multi-step goals, findings, or items you need to remember across the entire session. The scratchpad is automatically included in your context.",
    parameters: z.object({
        action: z.enum(["read", "write", "append"]),
        content: z.string().optional().describe("Content to write or append to the scratchpad"),
    }),
    execute: async (args, ctx) => {
        const session = await Session.get(ctx.sessionID)
        const current = session.scratchpad ?? ""

        if (args.action === "read") {
            return {
                title: "Scratchpad Contents",
                output: current || "(Scratchpad is empty)",
                metadata: { scratchpad: current }
            }
        }

        let nextValue = current
        if (args.action === "write") {
            nextValue = args.content ?? ""
        } else if (args.action === "append") {
            nextValue = current ? `${current}\n${args.content ?? ""}` : (args.content ?? "")
        }

        await Session.setScratchpad({ sessionID: ctx.sessionID, content: nextValue })

        return {
            title: `Scratchpad ${args.action === "write" ? "Updated" : "Updated"}`,
            output: `Scratchpad updated successfully.\n\nNew Content:\n${nextValue}`,
            metadata: { scratchpad: nextValue }
        }
    }
})
