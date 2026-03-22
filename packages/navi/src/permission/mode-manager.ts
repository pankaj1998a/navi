/**
 * Centralized Permission Mode Manager
 *
 * Manages agent permission modes for tool execution.
 * Supports three modes: Safe (read-only), Ask (prompt for edits), Allow-All (auto-approve).
 */

import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { PermissionMode, PERMISSION_MODE_ORDER } from "./mode-types"

const log = Log.create({ service: "mode-manager" })

export interface ModeState {
    sessionId: string
    permissionMode: PermissionMode
}

export interface ModeStateCallbacks {
    onStateChange?: (state: ModeState) => void
}

class ModeManager {
    private states: Map<string, ModeState> = new Map()
    private callbacks: Map<string, ModeStateCallbacks> = new Map()

    getState(sessionId: string): ModeState {
        let state = this.states.get(sessionId)
        if (!state) {
            state = {
                sessionId,
                permissionMode: "ask", // Default to 'ask'
            }
            this.states.set(sessionId, state)
        }
        return state
    }

    setPermissionMode(sessionId: string, mode: PermissionMode): void {
        const existing = this.getState(sessionId)
        const newState = { ...existing, permissionMode: mode }
        this.states.set(sessionId, newState)
        log.info("Set permission mode", { sessionId, mode })
        
        // Notify callbacks
        const callbacks = this.callbacks.get(sessionId)
        if (callbacks?.onStateChange) {
            callbacks.onStateChange(newState)
        }
    }

    cyclePermissionMode(sessionId: string): PermissionMode {
        const current = this.getState(sessionId).permissionMode
        const currentIndex = PERMISSION_MODE_ORDER.indexOf(current)
        const nextIndex = (currentIndex + 1) % PERMISSION_MODE_ORDER.length
        const nextMode = PERMISSION_MODE_ORDER[nextIndex]
        this.setPermissionMode(sessionId, nextMode)
        return nextMode
    }

    initializeModeState(sessionId: string, initialMode: PermissionMode, callbacks?: ModeStateCallbacks): void {
        if (callbacks) {
            this.callbacks.set(sessionId, callbacks)
        }
        this.setPermissionMode(sessionId, initialMode)
    }

    cleanupSession(sessionId: string): void {
        this.states.delete(sessionId)
        this.callbacks.delete(sessionId)
    }
}

export const modeManager = new ModeManager()

export function getPermissionMode(sessionId: string): PermissionMode {
    return modeManager.getState(sessionId).permissionMode
}

export function setPermissionMode(sessionId: string, mode: PermissionMode): void {
    modeManager.setPermissionMode(sessionId, mode)
}

export function cyclePermissionMode(sessionId: string): PermissionMode {
    return modeManager.cyclePermissionMode(sessionId)
}

export function initializeModeState(sessionId: string, initialMode: PermissionMode, callbacks?: ModeStateCallbacks): void {
    modeManager.initializeModeState(sessionId, initialMode, callbacks)
}

export function cleanupModeState(sessionId: string): void {
    modeManager.cleanupSession(sessionId)
}
