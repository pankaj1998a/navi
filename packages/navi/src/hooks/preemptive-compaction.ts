/**
 * Preemptive Compaction Hook for Navi
 *
 * Automatically compacts the session context before hitting the model's
 * context limit. This prevents context overflow errors and maintains
 * conversation continuity.
 *
 * Features:
 * - Monitors token usage after each message
 * - Triggers compaction when usage exceeds threshold (default 70%)
 * - Cooldown period to prevent rapid successive compactions
 * - Works with Claude models (expandable to others)
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@navi-ai/plugin"
import { Log } from "../util/log"

const log = Log.create({ service: "preemptive-compaction" })

// Default threshold (70% of context limit)
const DEFAULT_THRESHOLD = 0.7

// Minimum tokens before considering compaction
const MIN_TOKENS_FOR_COMPACTION = 50000

// Cooldown between compactions (5 minutes)
const COMPACTION_COOLDOWN_MS = 5 * 60 * 1000

// Model patterns that support compaction
const SUPPORTED_MODEL_PATTERNS = [
    /claude/i, // Anthropic Claude
    /gemini/i, // Google Gemini
    /gpt/i, // OpenAI GPT
]

// Default context limits by model pattern
const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
    claude: 200000,
    gemini: 1000000,
    gpt: 128000,
}

/**
 * Token usage info
 */
interface TokenInfo {
    input: number
    output: number
    cache: { read: number; write: number }
}

/**
 * Message info from events
 */
interface MessageInfo {
    id: string
    role: string
    sessionID: string
    providerID?: string
    modelID?: string
    tokens?: TokenInfo
    summary?: boolean
    finish?: boolean
}

/**
 * State for tracking compaction
 */
interface CompactionState {
    lastCompactionTime: Map<string, number>
    compactionInProgress: Set<string>
}

function createState(): CompactionState {
    return {
        lastCompactionTime: new Map(),
        compactionInProgress: new Set(),
    }
}

/**
 * Check if model supports compaction
 */
function isSupportedModel(modelID: string): boolean {
    return SUPPORTED_MODEL_PATTERNS.some((pattern) => pattern.test(modelID))
}

/**
 * Get context limit for a model
 */
function getContextLimit(modelID: string): number {
    const modelLower = modelID.toLowerCase()

    for (const [pattern, limit] of Object.entries(DEFAULT_CONTEXT_LIMITS)) {
        if (modelLower.includes(pattern)) {
            return limit
        }
    }

    // Default to 128k if unknown
    return 128000
}

export interface PreemptiveCompactionOptions {
    enabled?: boolean
    threshold?: number // Default 0.7 (70%)
    minTokens?: number // Minimum tokens before considering compaction
    cooldownMs?: number // Cooldown between compactions
}

/**
 * Create the preemptive compaction hook
 */
export function createPreemptiveCompactionHook(options?: PreemptiveCompactionOptions) {
    const {
        enabled = true,
        threshold = DEFAULT_THRESHOLD,
        minTokens = MIN_TOKENS_FOR_COMPACTION,
        cooldownMs = COMPACTION_COOLDOWN_MS,
    } = options ?? {}

    if (!enabled) {
        return { event: async () => { } }
    }

    const state = createState()

    /**
     * Check and trigger compaction if needed
     */
    async function checkAndTriggerCompaction(
        sessionID: string,
        lastAssistant: MessageInfo
    ): Promise<void> {
        // Skip if already compacting
        if (state.compactionInProgress.has(sessionID)) return

        // Check cooldown
        const lastCompaction = state.lastCompactionTime.get(sessionID) ?? 0
        if (Date.now() - lastCompaction < cooldownMs) return

        // Skip summary messages
        if (lastAssistant.summary === true) return

        // Need token info
        const tokens = lastAssistant.tokens
        if (!tokens) return

        const modelID = lastAssistant.modelID ?? ""
        const providerID = lastAssistant.providerID ?? ""

        // Check if model is supported
        if (!isSupportedModel(modelID)) {
            log.info("Skipping unsupported model", { modelID })
            return
        }

        // Calculate usage
        const contextLimit = getContextLimit(modelID)
        const totalUsed = tokens.input + tokens.cache.read + tokens.output

        // Skip if below minimum
        if (totalUsed < minTokens) return

        const usageRatio = totalUsed / contextLimit

        log.info("Checking context usage", {
            sessionID,
            totalUsed,
            contextLimit,
            usageRatio: usageRatio.toFixed(2),
            threshold,
        })

        // Skip if below threshold
        if (usageRatio < threshold) return

        // Trigger compaction
        state.compactionInProgress.add(sessionID)
        state.lastCompactionTime.set(sessionID, Date.now())

        if (!providerID || !modelID) {
            state.compactionInProgress.delete(sessionID)
            return
        }

        log.info("Triggering preemptive compaction", {
            sessionID,
            usageRatio: usageRatio.toFixed(2),
            providerID,
            modelID,
        })

        try {
            // TODO: Call session.summarize API
            // await ctx.client.session.summarize({
            //   path: { id: sessionID },
            //   body: { providerID, modelID, auto: true },
            // })

            log.info("Compaction would be triggered", { sessionID, usageRatio })
        } catch (err) {
            log.error("Compaction failed", { sessionID, error: err })
        } finally {
            state.compactionInProgress.delete(sessionID)
        }
    }

    return {
        /**
         * Event handler to monitor token usage
         */
        event: async (input: { event: { type: string; properties?: unknown } }): Promise<void> => {
            const props = input.event.properties as Record<string, unknown> | undefined

            // Clean up on session deletion
            if (input.event.type === "session.deleted") {
                const sessionInfo = props?.info as { id?: string } | undefined
                if (sessionInfo?.id) {
                    state.lastCompactionTime.delete(sessionInfo.id)
                    state.compactionInProgress.delete(sessionInfo.id)
                }
                return
            }

            // Check on message updates
            if (input.event.type === "message.updated") {
                const info = props?.info as MessageInfo | undefined
                if (!info) return

                // Only check completed assistant messages
                if (info.role !== "assistant" || !info.finish) return

                const sessionID = info.sessionID
                if (!sessionID) return

                await checkAndTriggerCompaction(sessionID, info)
                return
            }

            // Also check on session idle
            if (input.event.type === "session.idle") {
                const sessionID = props?.sessionID as string | undefined
                if (!sessionID) return

                // TODO: Fetch last assistant message and check
                // This would require session.messages API access
            }
        },
    }
}

export default createPreemptiveCompactionHook

