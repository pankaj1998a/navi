/**
 * Todo Continuation Enforcer Hook for Navi
 *
 * Monitors session state and automatically continues work when:
 * - Session becomes idle with incomplete TODOs
 * - Agent stops responding but tasks remain
 *
 * Features:
 * - Countdown timer before auto-resume (user can interrupt)
 * - Respects abort signals
 * - Skips planner agents
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@navi-ai/plugin"
import { Log } from "@navi-ai/core/util/log"

const log = Log.create({ service: "todo-enforcer" })

const HOOK_NAME = "todo-continuation-enforcer"

// Default agents to skip (planners shouldn't execute, just plan)
const DEFAULT_SKIP_AGENTS = ["plan", "architect", "prometheus"]

const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TODO CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

const COUNTDOWN_SECONDS = 2

interface SessionState {
    countdownTimer?: ReturnType<typeof setTimeout>
    isRecovering?: boolean
    abortDetectedAt?: number
}

interface Todo {
    content: string
    status: string
    priority: string
    id: string
}

/**
 * Get count of incomplete todos
 */
function getIncompleteCount(todos: Todo[]): number {
    return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
}

export interface TodoContinuationEnforcer {
    event: Hooks["event"]
    markRecovering: (sessionID: string) => void
    markRecoveryComplete: (sessionID: string) => void
}

export interface TodoContinuationEnforcerOptions {
    skipAgents?: string[]
}

/**
 * Creates the todo continuation enforcer hook
 */
export function createTodoContinuationEnforcerHook(options: TodoContinuationEnforcerOptions = {}): TodoContinuationEnforcer {
    const { skipAgents = DEFAULT_SKIP_AGENTS } = options
    const sessions = new Map<string, SessionState>()

    function getState(sessionID: string): SessionState {
        let state = sessions.get(sessionID)
        if (!state) {
            state = {}
            sessions.set(sessionID, state)
        }
        return state
    }

    function cancelCountdown(sessionID: string): void {
        const state = sessions.get(sessionID)
        if (!state) return

        if (state.countdownTimer) {
            clearTimeout(state.countdownTimer)
            state.countdownTimer = undefined
        }
    }

    function cleanup(sessionID: string): void {
        cancelCountdown(sessionID)
        sessions.delete(sessionID)
    }

    const markRecovering = (sessionID: string): void => {
        const state = getState(sessionID)
        state.isRecovering = true
        cancelCountdown(sessionID)
        log.info("Session marked as recovering", { sessionID })
    }

    const markRecoveryComplete = (sessionID: string): void => {
        const state = sessions.get(sessionID)
        if (state) {
            state.isRecovering = false
            log.info("Session recovery complete", { sessionID })
        }
    }

    const event: Hooks["event"] = async (input) => {
        const event = input.event as { type: string; properties?: Record<string, unknown> }
        const props = event.properties

        // Handle session errors
        if (event.type === "session.error") {
            const sessionID = props?.sessionID as string | undefined
            if (!sessionID) return

            const error = props?.error as { name?: string } | undefined
            if (error?.name === "MessageAbortedError" || error?.name === "AbortError") {
                const state = getState(sessionID)
                state.abortDetectedAt = Date.now()
                log.info("Abort detected via session.error", { sessionID, errorName: error.name })
            }

            cancelCountdown(sessionID)
            return
        }

        // Handle session idle - this is where we check for incomplete todos
        if (event.type === "session.idle") {
            const sessionID = props?.sessionID as string | undefined
            if (!sessionID) return

            log.info("session.idle detected", { sessionID })

            const state = getState(sessionID)

            // Skip if recovering from an error
            if (state.isRecovering) {
                log.info("Skipped: in recovery", { sessionID })
                return
            }

            // Skip if recently aborted
            if (state.abortDetectedAt) {
                const timeSinceAbort = Date.now() - state.abortDetectedAt
                const ABORT_WINDOW_MS = 3000
                if (timeSinceAbort < ABORT_WINDOW_MS) {
                    log.info(`Skipped: abort detected ${timeSinceAbort}ms ago`, { sessionID })
                    state.abortDetectedAt = undefined
                    return
                }
                state.abortDetectedAt = undefined
            }

            // Get todos - in a real implementation, this would call the session API
            // For now, we just log that we would check
            log.info("Would check for incomplete todos", { sessionID })

            // TODO: Implement actual todo checking and continuation injection
            // This would require access to the session client to:
            // 1. Fetch todos: ctx.client.session.todo({ path: { id: sessionID } })
            // 2. Check for incomplete: getIncompleteCount(todos)
            // 3. Inject continuation: ctx.client.session.prompt({ ... })

            return
        }

        // Handle message updates - cancel countdown on user activity
        if (event.type === "message.updated") {
            const info = props?.info as Record<string, unknown> | undefined
            const sessionID = info?.sessionID as string | undefined
            const role = info?.role as string | undefined

            if (!sessionID) return

            if (role === "user" || role === "assistant") {
                const state = sessions.get(sessionID)
                if (state) state.abortDetectedAt = undefined
                cancelCountdown(sessionID)
            }
            return
        }

        // Handle tool execution - cancel countdown during tool use
        if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
            const sessionID = props?.sessionID as string | undefined
            if (sessionID) {
                const state = sessions.get(sessionID)
                if (state) state.abortDetectedAt = undefined
                cancelCountdown(sessionID)
            }
            return
        }

        // Handle session deletion
        if (event.type === "session.deleted") {
            const sessionInfo = props?.info as { id?: string } | undefined
            if (sessionInfo?.id) {
                cleanup(sessionInfo.id)
                log.info("Session deleted: cleaned up", { sessionID: sessionInfo.id })
            }
            return
        }
    }

    return {
        event,
        markRecovering,
        markRecoveryComplete,
    }
}

export default createTodoContinuationEnforcerHook

