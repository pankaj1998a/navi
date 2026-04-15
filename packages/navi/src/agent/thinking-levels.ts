/**
 * Thinking Levels
 *
 * Granular control over reasoning effort vs. cost.
 * Supports: off, think, max with ultrathink override and adaptive mode.
 */

import { z } from "zod";

/**
 * Thinking level for extended reasoning
 * - 'off': No extended thinking (cheapest)
 * - 'think': Standard thinking (balanced)
 * - 'max': Maximum thinking tokens (most expensive)
 * - 'adaptive': Automatically adjusts based on task complexity
 */
export type ThinkingLevel = "off" | "think" | "max" | "adaptive";

/**
 * Default thinking level
 */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "adaptive";

/**
 * Thinking token configuration per model
 */
export interface ThinkingTokensConfig {
    off: number;
    think: number;
    max: number;
}

/**
 * Model-specific thinking token configurations
 */
export const MODEL_THINKING_TOKENS: Record<string, ThinkingTokensConfig> = {
    // Claude models
    "claude-3-5-sonnet-latest": { off: 0, think: 2048, max: 16384 },
    "claude-3-5-sonnet-20241022": { off: 0, think: 2048, max: 16384 },
    "claude-3-5-sonnet-20240620": { off: 0, think: 2048, max: 16384 },
    "claude-3-opus-latest": { off: 0, think: 2048, max: 16384 },
    "claude-3-opus-20240229": { off: 0, think: 2048, max: 16384 },
    "claude-3-haiku-20240307": { off: 0, think: 1024, max: 4096 },

    // Default for unknown models
    "default": { off: 0, think: 2048, max: 8192 },
};

/**
 * Get thinking tokens for a model and thinking level
 */
export function getThinkingTokens(thinkingLevel: ThinkingLevel, modelId: string): number {
    const config = MODEL_THINKING_TOKENS[modelId] || MODEL_THINKING_TOKENS["default"];
    if (thinkingLevel === "adaptive") {
        return config.think;
    }
    return config[thinkingLevel];
}

/**
 * Get all available thinking levels
 */
export function getThinkingLevels(): ThinkingLevel[] {
    return ["off", "think", "max", "adaptive"];
}

/**
 * Get display name for thinking level
 */
export function getThinkingLevelName(level: ThinkingLevel): string {
    const names: Record<ThinkingLevel, string> = {
        "off": "Off",
        "think": "Think",
        "max": "Max",
        "adaptive": "Adaptive",
    };
    return names[level];
}

/**
 * Get description for thinking level
 */
export function getThinkingLevelDescription(level: ThinkingLevel): string {
    const descriptions: Record<ThinkingLevel, string> = {
        "off": "No extended thinking (fastest, cheapest)",
        "think": "Standard thinking (balanced)",
        "max": "Maximum thinking (slower, more expensive)",
        "adaptive": "Automatically adjusts based on task complexity",
    };
    return descriptions[level];
}

/**
 * Cycle to next thinking level
 */
export function cycleThinkingLevel(current: ThinkingLevel): ThinkingLevel {
    const levels: ThinkingLevel[] = ["off", "think", "max", "adaptive"];
    const currentIndex = levels.indexOf(current);
    const nextIndex = (currentIndex + 1) % levels.length;
    return levels[nextIndex];
}

/**
 * Parse thinking level from string
 */
export function parseThinkingLevel(level: string): ThinkingLevel | null {
    const validLevels: ThinkingLevel[] = ["off", "think", "max", "adaptive"];
    if (validLevels.includes(level as ThinkingLevel)) {
        return level as ThinkingLevel;
    }
    return null;
}

/**
 * Thinking Level Manager
 */
export interface ThinkingState {
    sessionID: string;
    thinkingLevel: ThinkingLevel;
}

class ThinkingLevelManager {
    private states: Map<string, ThinkingState> = new Map();

    getState(sessionID: string): ThinkingState {
        let state = this.states.get(sessionID);
        if (!state) {
            state = {
                sessionID,
                thinkingLevel: DEFAULT_THINKING_LEVEL,
            };
            this.states.set(sessionID, state);
        }
        return state;
    }

    setThinkingLevel(sessionID: string, level: ThinkingLevel): void {
        this.states.set(sessionID, { sessionID, thinkingLevel: level });
    }

    cycleThinkingLevel(sessionID: string): ThinkingLevel {
        const current = this.getState(sessionID).thinkingLevel;
        const next = cycleThinkingLevel(current);
        this.setThinkingLevel(sessionID, next);
        return next;
    }

    cleanupSession(sessionID: string): void {
        this.states.delete(sessionID);
    }
}

export const thinkingLevelManager = new ThinkingLevelManager();

export function getThinkingLevel(sessionID: string): ThinkingLevel {
    return thinkingLevelManager.getState(sessionID).thinkingLevel;
}

export function setThinkingLevel(sessionID: string, level: ThinkingLevel): void {
    thinkingLevelManager.setThinkingLevel(sessionID, level);
}

export function cycleThinkingLevelForSession(sessionID: string): ThinkingLevel {
    return thinkingLevelManager.cycleThinkingLevel(sessionID);
}


