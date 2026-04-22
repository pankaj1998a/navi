/**
 * Ralph Loop Hook for Navi
 *
 * Continuous execution loop that keeps running until the agent
 * outputs a specific completion promise. Named after the Simpsons'
 * Ralph Wiggum who keeps trying.
 *
 * Features:
 * - Starts via /ralph-loop command or API
 * - Continues until <promise>done</promise> is output
 * - Configurable max iterations
 * - Persists state across restarts
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks, PluginInput } from "@navi-ai/plugin"
import { Log } from "../util/log"
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"

const log = Log.create({ service: "ralph-loop" })

const HOOK_NAME = "ralph-loop"
const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_COMPLETION_PROMISE = "done"

const CONTINUATION_PROMPT = `[RALPH LOOP - ITERATION {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off  
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

/**
 * Ralph Loop state persisted to disk
 */
export interface RalphLoopState {
    active: boolean
    iteration: number
    max_iterations: number
    completion_promise: string
    started_at: string
    prompt: string
    session_id: string
}

/**
 * Get the path to the Ralph Loop state file
 */
function getStateFilePath(directory: string): string {
    const stateDir = join(directory, ".navi")
    if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true })
    }
    return join(stateDir, "ralph-loop.json")
}

/**
 * Read Ralph Loop state from disk
 */
function readState(directory: string): RalphLoopState | null {
    const statePath = getStateFilePath(directory)
    if (!existsSync(statePath)) return null

    try {
        const content = readFileSync(statePath, "utf-8")
        return JSON.parse(content) as RalphLoopState
    } catch {
        return null
    }
}

/**
 * Write Ralph Loop state to disk
 */
function writeState(directory: string, state: RalphLoopState): boolean {
    try {
        const statePath = getStateFilePath(directory)
        writeFileSync(statePath, JSON.stringify(state, null, 2))
        return true
    } catch (err) {
        log.error("Failed to write state", { error: err })
        return false
    }
}

/**
 * Clear Ralph Loop state
 */
function clearState(directory: string): boolean {
    try {
        const statePath = getStateFilePath(directory)
        if (existsSync(statePath)) {
            unlinkSync(statePath)
        }
        return true
    } catch (err) {
        log.error("Failed to clear state", { error: err })
        return false
    }
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export interface RalphLoopHook {
    event: Hooks["event"]
    startLoop: (
        sessionID: string,
        prompt: string,
        options?: { maxIterations?: number; completionPromise?: string }
    ) => boolean
    cancelLoop: (sessionID: string) => boolean
    getState: () => RalphLoopState | null
}

export interface RalphLoopOptions {
    directory: string
    defaultMaxIterations?: number
    completionPromise?: string
}

/**
 * Creates the Ralph Loop hook
 */
export function createRalphLoopHook(options: RalphLoopOptions & { input: PluginInput }): RalphLoopHook {
    const { input, directory, defaultMaxIterations = DEFAULT_MAX_ITERATIONS, completionPromise: defaultPromise = DEFAULT_COMPLETION_PROMISE } = options

    // Track sessions in recovery
    const recoveringSessions = new Set<string>()

    /**
     * Start a new Ralph Loop
     */
    const startLoop = (
        sessionID: string,
        prompt: string,
        loopOptions?: { maxIterations?: number; completionPromise?: string }
    ): boolean => {
        const state: RalphLoopState = {
            active: true,
            iteration: 1,
            max_iterations: loopOptions?.maxIterations ?? defaultMaxIterations,
            completion_promise: loopOptions?.completionPromise ?? defaultPromise,
            started_at: new Date().toISOString(),
            prompt,
            session_id: sessionID,
        }

        const success = writeState(directory, state)
        if (success) {
            log.info("Ralph Loop started", {
                sessionID,
                maxIterations: state.max_iterations,
                completionPromise: state.completion_promise,
            })
        }
        return success
    }

    /**
     * Cancel an active Ralph Loop
     */
    const cancelLoop = (sessionID: string): boolean => {
        const state = readState(directory)
        if (!state || state.session_id !== sessionID) {
            return false
        }

        const success = clearState(directory)
        if (success) {
            log.info("Ralph Loop cancelled", { sessionID, iteration: state.iteration })
        }
        return success
    }

    /**
     * Get current Ralph Loop state
     */
    const getState = (): RalphLoopState | null => {
        return readState(directory)
    }

    /**
     * Check if the completion promise is in the message
     */
    function detectCompletion(text: string, promise: string): boolean {
        const pattern = new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, "is")
        return pattern.test(text)
    }

    /**
     * Event handler for session.idle - continues the loop if needed
     */
    const event: Hooks["event"] = async (eventInput) => {
        const eventData = eventInput.event as { type: string; properties?: Record<string, unknown> }
        const props = eventData.properties

        // Handle session idle - check if we need to continue the loop
        if (eventData.type === "session.idle") {
            const sessionID = props?.sessionID as string | undefined
            if (!sessionID) return

            // Skip if recovering from error
            if (recoveringSessions.has(sessionID)) {
                log.info("Skipped: in recovery", { sessionID })
                return
            }

            const state = readState(directory)
            if (!state || !state.active) {
                return
            }

            // Only continue for the session that started the loop
            if (state.session_id && state.session_id !== sessionID) {
                return
            }

            // Check if max iterations reached
            if (state.iteration >= state.max_iterations) {
                log.info("Max iterations reached", {
                    sessionID,
                    iteration: state.iteration,
                    max: state.max_iterations,
                })
                clearState(directory)
                return
            }

            // Check if completion promise was output
            try {
                const { data: messages } = await (input.client.session as any).messages({ sessionID, limit: 5 })
                const lastAiMessage = [...(messages || [])].reverse().find(m => m.info.role === 'assistant')
                
                if (lastAiMessage?.parts) {
                    const text = lastAiMessage.parts
                        .map((p: any) => p.type === 'text' ? (p as any).text : '')
                        .join('')
                    
                    if (detectCompletion(text, state.completion_promise)) {
                        log.info("Completion promise detected, loop finished", { sessionID })
                        clearState(directory)
                        return
                    }
                }
            } catch (err) {
                log.error("Failed to check for completion promise", { error: err })
            }

            // Increment iteration
            const newIteration = state.iteration + 1
            const newState: RalphLoopState = {
                ...state,
                iteration: newIteration,
            }
            writeState(directory, newState)

            log.info("Continuing loop", {
                sessionID,
                iteration: newIteration,
                max: state.max_iterations,
            })

            // Build continuation prompt
            const continuationPrompt = CONTINUATION_PROMPT
                .replace("{{ITERATION}}", String(newIteration))
                .replace("{{MAX}}", String(state.max_iterations))
                .replace("{{PROMISE}}", state.completion_promise)
                .replace("{{PROMPT}}", state.prompt)

            // Inject continuation prompt
            try {
                await (input.client.session as any).prompt({
                    sessionID,
                    parts: [{ type: "text", text: continuationPrompt }]
                })
                log.info("Injected continuation prompt", { sessionID })
            } catch (err) {
                log.error("Failed to inject continuation prompt", { error: err })
            }
        }

        // Handle session deletion
        if (eventData.type === "session.deleted") {
            const sessionInfo = props?.info as { id?: string } | undefined
            if (sessionInfo?.id) {
                const state = readState(directory)
                if (state?.session_id === sessionInfo.id) {
                    clearState(directory)
                    log.info("Session deleted, loop cleared", { sessionID: sessionInfo.id })
                }
                recoveringSessions.delete(sessionInfo.id)
            }
        }

        // Handle session errors
        if (eventData.type === "session.error") {
            const sessionID = props?.sessionID as string | undefined
            const error = props?.error as { name?: string } | undefined

            // User abort clears the loop
            if (error?.name === "MessageAbortedError") {
                if (sessionID) {
                    const state = readState(directory)
                    if (state?.session_id === sessionID) {
                        clearState(directory)
                        log.info("User aborted, loop cleared", { sessionID })
                    }
                    recoveringSessions.delete(sessionID)
                }
                return
            }

            // Mark session as recovering on error
            if (sessionID) {
                recoveringSessions.add(sessionID)
                setTimeout(() => {
                    recoveringSessions.delete(sessionID)
                }, 5000)
            }
        }
    }

    return {
        event,
        startLoop,
        cancelLoop,
        getState,
    }
}

export default createRalphLoopHook

