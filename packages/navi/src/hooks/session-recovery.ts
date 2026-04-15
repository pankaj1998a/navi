/**
 * Session Recovery Hook for Navi
 *
 * Automatically recovers from session errors:
 * - Tool crashes (missing tool results)
 * - Thinking block ordering issues
 * - Empty content messages
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@navi-ai/plugin"
import { SessionID } from "../session/schema"
import { Log } from "../util/log"
import { Session } from "../session"
import { MemoryManager } from "../agent/memory-manager"
import { analyzeSessionForRecovery } from "../session/intelligent-recovery"

const log = Log.create({ service: "session-recovery" })

const RECOVERY_RESUME_TEXT = "[session recovered - continuing previous task]"
const PLACEHOLDER_TEXT = "[user interrupted]"

/**
 * Types of recoverable errors
 */
type RecoveryErrorType =
    | "tool_result_missing"
    | "thinking_block_order"
    | "thinking_disabled_violation"
    | "empty_content"
    | null

/**
 * Session recovery hook state
 */
export interface SessionRecoveryState {
    isRecovering: boolean
    lastError?: string
    recoveryCount: number
}

// Track recovery state per session
const recoveryState = new Map<string, SessionRecoveryState>()

// Track errors being processed to prevent duplicate recovery
const processingErrors = new Set<string>()

/**
 * Get session recovery state
 */
export function getRecoveryState(sessionID: SessionID): SessionRecoveryState | undefined {
    return recoveryState.get(sessionID)
}

/**
 * Check if session is currently recovering
 */
export function isRecovering(sessionID: SessionID): boolean {
    return recoveryState.get(sessionID)?.isRecovering ?? false
}

/**
 * Get error message from various error formats
 */
function getErrorMessage(error: unknown): string {
    if (!error) return ""
    if (typeof error === "string") return error.toLowerCase()

    const errorObj = error as Record<string, unknown>
    const paths = [errorObj.data, errorObj.error, errorObj, (errorObj.data as Record<string, unknown>)?.error]

    for (const obj of paths) {
        if (obj && typeof obj === "object") {
            const msg = (obj as Record<string, unknown>).message
            if (typeof msg === "string" && msg.length > 0) {
                return msg.toLowerCase()
            }
        }
    }

    try {
        return JSON.stringify(error).toLowerCase()
    } catch {
        return ""
    }
}

/**
 * Detect the type of error for recovery
 */
export function detectErrorType(error: unknown): RecoveryErrorType {
    const message = getErrorMessage(error)

    // Tool result missing (ESC pressed, timeout, crash)
    if (message.includes("tool_use") && message.includes("tool_result")) {
        return "tool_result_missing"
    }

    // Thinking block ordering issues
    if (
        message.includes("thinking") &&
        (message.includes("first block") ||
            message.includes("must start with") ||
            message.includes("preceeding") ||
            message.includes("final block") ||
            message.includes("cannot be thinking") ||
            (message.includes("expected") && message.includes("found")))
    ) {
        return "thinking_block_order"
    }

    // Thinking disabled but blocks present
    if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
        return "thinking_disabled_violation"
    }

    // Empty content in messages
    if (
        message.includes("messages.") &&
        (message.includes("empty") || message.includes("content") || message.includes("text"))
    ) {
        return "empty_content"
    }

    return null
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
    return detectErrorType(error) !== null
}

export interface SessionRecoveryOptions {
    autoResume?: boolean
}

export interface SessionRecoveryHook {
    event: Hooks["event"]
    handleError: (sessionID: SessionID, messageID: string, error: unknown) => Promise<boolean>
    isRecoverableError: (error: unknown) => boolean
    isRecovering: (sessionID: SessionID) => boolean
}

/**
 * Create the session recovery hook
 */
export function createSessionRecoveryHook(options?: SessionRecoveryOptions): SessionRecoveryHook {
    const { autoResume = true } = options ?? {}

    /**
     * Handle session error recovery
     */
    const handleError = async (
        sessionID: SessionID,
        messageID: string,
        error: unknown
    ): Promise<boolean> => {
        const errorType = detectErrorType(error)
        if (!errorType) return false

        // Prevent duplicate recovery attempts
        const errorKey = `${sessionID}:${messageID}`
        if (processingErrors.has(errorKey)) return false
        processingErrors.add(errorKey)

        // Get or create recovery state
        let state = recoveryState.get(sessionID)
        if (!state) {
            state = { isRecovering: false, recoveryCount: 0 }
            recoveryState.set(sessionID, state)
        }

        state.isRecovering = true
        state.lastError = getErrorMessage(error).slice(0, 100)

        try {
            log.info("Session recovery started", { sessionID, messageID, errorType })

            const messages = await Session.messages({ sessionID }).catch(() => [])
            const context = messages.length ? analyzeSessionForRecovery(messages) : undefined
            if (context?.summary) {
                await MemoryManager.store(context.summary, {
                    tier: "medium",
                    importance: 0.75,
                    tags: [`session:${sessionID}`, "recovery"],
                    metadata: {
                        recovery: true,
                        errorType,
                        lastActivity: context.lastActivity,
                    },
                })
            }

            log.info("Recovery snapshot stored", {
                sessionID,
                errorType,
                recoveryActions: getRecoveryActions(errorType),
            })

            state.recoveryCount++

            if (autoResume) {
                log.info("Recovery snapshot ready for resume", { sessionID, hasContext: Boolean(context?.summary) })
            }

            return true
        } catch (err) {
            log.error("Session recovery failed", { sessionID, error: err })
            return false
        } finally {
            state.isRecovering = false
            processingErrors.delete(errorKey)
        }
    }

    /**
     * Get recovery actions for an error type
     */
    function getRecoveryActions(errorType: RecoveryErrorType): string[] {
        switch (errorType) {
            case "tool_result_missing":
                return ["abort session", "find pending tool calls", "inject cancelled results"]
            case "thinking_block_order":
                return ["find orphan thinking blocks", "prepend thinking to affected messages"]
            case "thinking_disabled_violation":
                return ["find messages with thinking", "strip thinking blocks"]
            case "empty_content":
                return ["find empty messages", "inject placeholder text"]
            default:
                return []
        }
    }

    /**
     * Event handler for session errors
     */
    const event: Hooks["event"] = async (input) => {
        const eventData = input.event as { type: string; properties?: Record<string, unknown> }
        const props = eventData.properties

        // Handle session errors
        if (eventData.type === "session.error") {
            const sessionID = props?.sessionID as SessionID | undefined
            const error = props?.error as unknown
            const messageInfo = props?.info as { id?: string; role?: string } | undefined

            if (sessionID && messageInfo?.id && messageInfo?.role === "assistant" && error) {
                const recovered = await handleError(sessionID, messageInfo.id, error)
                if (recovered) {
                    log.info("Session recovery completed", { sessionID, messageID: messageInfo.id })
                }
            }
        }

        // Clean up on session deletion
        if (eventData.type === "session.deleted") {
            const sessionInfo = props?.info as { id?: string } | undefined
            if (sessionInfo?.id) {
                recoveryState.delete(sessionInfo.id)
            }
        }
    }

    return {
        event,
        handleError,
        isRecoverableError,
        isRecovering: (sessionID: SessionID) => isRecovering(sessionID),
    }
}

export default createSessionRecoveryHook

