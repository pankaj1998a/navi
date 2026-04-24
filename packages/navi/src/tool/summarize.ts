/**
 * Smart summarization utility for large tool results.
 */

import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import { LLM } from "../session/llm"
import { Agent } from "../agent/agent"
import { MessageID, SessionID } from "../session/schema"
import { ProviderID, ModelID } from "../provider/schema"
import { MessageV2 } from "../session/message-v2"

const log = Log.create({ service: "summarize" })

// Token limit for summarization trigger (roughly ~50KB of text)
export const TOKEN_LIMIT = 12500

// Max tokens to send for summarization (~400KB)
const MAX_SUMMARIZATION_INPUT = 100000

/**
 * Context for summarization - helps the LLM extract relevant information
 */
export interface SummarizationContext {
    /** Tool name */
    toolName: string
    /** Tool input parameters */
    input?: Record<string, unknown>
    /** The AI assistant's goal or intent */
    modelIntent?: string
    /** The session ID */
    sessionID?: string
}

/**
 * Summarize a large tool result to fit within context limits.
 */
export async function summarizeLargeResult(response: string, context: SummarizationContext): Promise<string> {
    log.info("Summarizing large result", { tool: context.toolName, length: response.length })

    if (!context.sessionID) {
        log.warn("No session ID provided for summarization, falling back to truncation")
        return response.substring(0, 40000) + "\n\n[Result truncated - no session ID]"
    }

    try {
        const agent = await Agent.get("summarize").catch(() => undefined)
        if (!agent) {
            log.warn("Summarize agent not found, falling back to truncation")
            return response.substring(0, 40000) + "\n\n[Result truncated - summarize agent not found]"
        }

        const model = agent.model
            ? await Provider.getModel(ProviderID.make(agent.model.providerID), ModelID.make(agent.model.modelID))
            : await resolveSmallModelForSession(context.sessionID)

        if (!model) {
            log.warn("No model available for summarization, falling back to truncation")
            return response.substring(0, 40000) + "\n\n[Result truncated - no model available]"
        }

        const stream = await LLM.stream({
            agent,
            model,
            messages: [
                {
                    role: "user",
                    content: `You are summarizing a tool result that was too large to fit in context.

Tool: ${context.toolName}
${context.input ? `Input: ${JSON.stringify(context.input)}` : ""}
${context.modelIntent ? `Goal: ${context.modelIntent}` : ""}

Your task:
1. Extract the MOST RELEVANT information based on the stated goal or request above.
2. Preserve key data points, IDs, URLs, and actionable information.
3. Summarize long text content but keep essential details.
4. Format the output cleanly.

Tool result to summarize:
${response.substring(0, MAX_SUMMARIZATION_INPUT * 4)}

Provide a concise but comprehensive summary.`,
                },
            ],
            abort: new AbortController().signal,
            sessionID: context.sessionID,
            system: [],
            retries: 2,
            user: {
                id: MessageID.ascending(),
                sessionID: SessionID.make(context.sessionID),
                role: "user",
                time: { created: Date.now() },
                agent: "summarize",
                model: { providerID: model.providerID, modelID: model.id },
            },
            tools: {},
        })

        const result = await stream.text
        return result
    } catch (error) {
        log.error("Summarization failed", { error })
        return response.substring(0, 40000) + "\n\n[Result truncated - summarization failed]"
    }
}

async function resolveSmallModelForSession(sessionID: string): Promise<Awaited<ReturnType<typeof Provider.getModel>>> {
    if (sessionID) {
        for await (const item of MessageV2.stream(SessionID.make(sessionID))) {
            if (item.info.role === "user" && item.info.model) {
                const providerID = ProviderID.make(item.info.model.providerID)
                const model = await Provider.getSmallModel(providerID)
                if (model) return model
                return await Provider.getModel(providerID, ModelID.make(item.info.model.modelID))
            }
        }
    }

    const fallback = await Provider.defaultModel()
    const fallbackSmall = await Provider.getSmallModel(fallback.providerID)
    if (fallbackSmall) return fallbackSmall
    return await Provider.getModel(fallback.providerID, fallback.modelID)
}


