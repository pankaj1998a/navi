/**
 * Context Window Monitor Hook for Navi
 *
 * Monitors token usage and reminds agents when context usage is high.
 * Prevents agents from rushing or skipping tasks when they think
 * they're running out of context space.
 *
 * Features:
 * - Tracks token usage per session
 * - Shows reminder at 70%+ context usage
 * - Prevents rushed/incomplete work
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@navi-ai/plugin"
import { Log } from "@navi-ai/core/util/log"

const log = Log.create({ service: "context-monitor" })

// Default context limits for common providers
const CONTEXT_LIMITS: Record<string, number> = {
    anthropic: 200_000,
    openai: 128_000,
    google: 1_000_000,
    "google-antigravity": 1_000_000,
}

// Threshold at which to show reminder
const CONTEXT_WARNING_THRESHOLD = 0.7

const CONTEXT_REMINDER = `[SYSTEM REMINDER - Context Window Status]

You have plenty of context remaining - do NOT rush or skip tasks.
Complete your work thoroughly and methodically.`

export interface ContextWindowMonitorHooks {
    "tool.execute.after": Hooks["tool.execute.after"]
    event: Hooks["event"]
}

/**
 * Creates the context window monitor hook
 */
export function createContextWindowMonitorHook(): ContextWindowMonitorHooks {
    // Track sessions we've already reminded
    const remindedSessions = new Set<string>()

    const toolExecuteAfter: Hooks["tool.execute.after"] = async (input, output) => {
        const { sessionID } = input

        // Only remind once per session
        if (remindedSessions.has(sessionID)) return

        try {
            // Get model info from input to determine context limit
            const model = (input as unknown as { model?: { providerID: string } }).model
            const providerID = model?.providerID ?? "anthropic"
            const contextLimit = CONTEXT_LIMITS[providerID] ?? 200_000

            // Get token usage from session info if available
            const tokens = (input as unknown as {
                tokens?: { input: number; output: number; cache?: { read: number } }
            }).tokens

            if (!tokens) return

            const totalInputTokens = (tokens.input ?? 0) + (tokens.cache?.read ?? 0)
            const usagePercentage = totalInputTokens / contextLimit

            // Only remind if usage is above threshold
            if (usagePercentage < CONTEXT_WARNING_THRESHOLD) return

            remindedSessions.add(sessionID)

            const usedPct = (usagePercentage * 100).toFixed(1)
            const remainingPct = ((1 - usagePercentage) * 100).toFixed(1)
            const usedTokens = totalInputTokens.toLocaleString()
            const limitTokens = contextLimit.toLocaleString()

            // Append reminder to tool output
            output.output += `\n\n${CONTEXT_REMINDER}
[Context Status: ${usedPct}% used (${usedTokens}/${limitTokens} tokens), ${remainingPct}% remaining]`

            log.info("Context reminder added", {
                sessionID,
                usagePercentage: usedPct,
                providerID,
            })
        } catch (err) {
            // Graceful degradation - do not disrupt tool execution
            log.warn("Failed to check context usage", { error: err })
        }
    }

    const event: Hooks["event"] = async (input) => {
        const event = input.event as { type: string; properties?: Record<string, unknown> }
        const props = event.properties

        // Clean up when session is deleted
        if (event.type === "session.deleted") {
            const sessionInfo = props?.info as { id?: string } | undefined
            if (sessionInfo?.id) {
                remindedSessions.delete(sessionInfo.id)
                log.info("Cleaned up session", { sessionID: sessionInfo.id })
            }
        }
    }

    return {
        "tool.execute.after": toolExecuteAfter,
        event,
    }
}

export default createContextWindowMonitorHook

