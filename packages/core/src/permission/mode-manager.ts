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
    sessionID: string
    permissionMode: PermissionMode
}

export interface ModeStateCallbacks {
    onStateChange?: (state: ModeState) => void
}

class ModeManager {
    private states: Map<string, ModeState> = new Map()
    private callbacks: Map<string, ModeStateCallbacks> = new Map()

    getState(sessionID: string): ModeState {
        let state = this.states.get(sessionID)
        if (!state) {
            state = {
                sessionID,
                permissionMode: "ask", // Default to 'ask'
            }
            this.states.set(sessionID, state)
        }
        return state
    }

    setPermissionMode(sessionID: string, mode: PermissionMode): void {
        const existing = this.getState(sessionID)
        const newState = { ...existing, permissionMode: mode }
        this.states.set(sessionID, newState)
        log.info("Set permission mode", { sessionID, mode })
        
        // Notify callbacks
        const callbacks = this.callbacks.get(sessionID)
        if (callbacks?.onStateChange) {
            callbacks.onStateChange(newState)
        }
    }

    cyclePermissionMode(sessionID: string): PermissionMode {
        const current = this.getState(sessionID).permissionMode
        const currentIndex = PERMISSION_MODE_ORDER.indexOf(current)
        const nextIndex = (currentIndex + 1) % PERMISSION_MODE_ORDER.length
        const nextMode = PERMISSION_MODE_ORDER[nextIndex]
        this.setPermissionMode(sessionID, nextMode)
        return nextMode
    }

    initializeModeState(sessionID: string, initialMode: PermissionMode, callbacks?: ModeStateCallbacks): void {
        if (callbacks) {
            this.callbacks.set(sessionID, callbacks)
        }
        this.setPermissionMode(sessionID, initialMode)
    }

    cleanupSession(sessionID: string): void {
        this.states.delete(sessionID)
        this.callbacks.delete(sessionID)
    }
}

export const modeManager = new ModeManager()

export function getPermissionMode(sessionID: string): PermissionMode {
    return modeManager.getState(sessionID).permissionMode
}

export function setPermissionMode(sessionID: string, mode: PermissionMode): void {
    modeManager.setPermissionMode(sessionID, mode)
}

export function cyclePermissionMode(sessionID: string): PermissionMode {
    return modeManager.cyclePermissionMode(sessionID)
}

export function initializeModeState(sessionID: string, initialMode: PermissionMode, callbacks?: ModeStateCallbacks): void {
    modeManager.initializeModeState(sessionID, initialMode, callbacks)
}

export function cleanupModeState(sessionID: string): void {
    modeManager.cleanupSession(sessionID)
}



