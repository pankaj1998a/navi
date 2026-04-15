/**
 * Extracted from prompt.ts — inserts agent-specific reminder prompts
 * into the message history before LLM processing.
 */
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { Agent } from "../../agent/agent"
import PROMPT_PLAN from "./plan.txt"
import BUILD_SWITCH from "./build-switch.txt"

/**
 * Inserts synthetic reminder parts into the last user message based on the active agent.
 * - For "plan" agent: appends the plan prompt
 * - For "build" agent after a plan turn: appends the build-switch prompt
 */
export function insertReminders(input: { messages: MessageV2.WithParts[]; agent: Agent.Info }): MessageV2.WithParts[] {
    const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
    if (!userMessage) return input.messages
    if (input.agent.name === "plan") {
        userMessage.parts.push({
            id: Identifier.ascending("part"),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            // TODO (for mr dax): update to use the anthropic full fledged one (see plan-reminder-anthropic.txt)
            text: PROMPT_PLAN,
            synthetic: true,
        })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
        userMessage.parts.push({
            id: Identifier.ascending("part"),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: BUILD_SWITCH,
            synthetic: true,
        })
    }
    return input.messages
}



