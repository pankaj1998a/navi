/**
 * Think Mode Hook for Navi
 *
 * Automatically detects thinking keywords in prompts and upgrades models
 * to their high-reasoning variants with extended thinking budgets.
 *
 * Features:
 * - Multi-language "think" keyword detection
 * - Auto-upgrades to high-reasoning model variants
 * - Injects appropriate thinking configs per provider
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@navi-ai/plugin"
import { Log } from "../util/log"

const log = Log.create({ service: "think-mode" })

// English patterns
const ENGLISH_PATTERNS = [/\bultrathink\b/i, /\bthink\b/i]

// Multilingual keywords for "think" in various languages
const MULTILINGUAL_KEYWORDS = [
    "생각", "고민", "검토", "제대로", // Korean
    "思考", "考虑", "考慮", // Chinese
    "考え", "熟考", // Japanese
    "सोच", "विचार", // Hindi
    "تفكير", "تأمل", // Arabic
    "চিন্তা", "ভাবনা", // Bengali
    "думать", "думай", "размышлять", // Russian
    "pensar", "pense", "refletir", // Portuguese
    "reflexionar", "reflexiona", // Spanish
    "penser", "réfléchir", "réfléchis", // French
    "denken", "nachdenken", // German
    "suy nghĩ", "cân nhắc", // Vietnamese
    "düşün", "düşünmek", // Turkish
    "pensare", "riflettere", // Italian
    "คิด", "พิจารณา", // Thai
    "myśl", "myśleć", "zastanów", // Polish
    "nadenken", // Dutch
    "berpikir", "pertimbangkan", // Indonesian
]

const MULTILINGUAL_PATTERNS = MULTILINGUAL_KEYWORDS.map((kw) => new RegExp(kw, "i"))
const THINK_PATTERNS = [...ENGLISH_PATTERNS, ...MULTILINGUAL_PATTERNS]

// Code block patterns to exclude from detection
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`[^`]+`/g

/**
 * Remove code blocks from text before checking for keywords
 */
function removeCodeBlocks(text: string): string {
    return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

/**
 * Detect if text contains thinking keywords
 */
export function detectThinkKeyword(text: string): boolean {
    const textWithoutCode = removeCodeBlocks(text)
    return THINK_PATTERNS.some((pattern) => pattern.test(textWithoutCode))
}

/**
 * Extract prompt text from message parts
 */
export function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
    return parts
        .filter((p) => p.type === "text")
        .map((p) => p.text || "")
        .join("")
}

// Maps model IDs to their high-reasoning variants
const HIGH_VARIANT_MAP: Record<string, string> = {
    // Claude
    "claude-sonnet-4-5": "claude-sonnet-4-5-high",
    "claude-opus-4-5": "claude-opus-4-5-high",
    // Gemini
    "gemini-3-pro": "gemini-3-pro-high",
    "gemini-3-pro-low": "gemini-3-pro-high",
    "gemini-3-pro-preview": "gemini-3-pro-preview-high",
    "gemini-3-flash": "gemini-3-flash-high",
    "gemini-3-flash-preview": "gemini-3-flash-preview-high",
    "gemini-2-5-pro": "gemini-2-5-pro-high",
    "gemini-2-5-flash": "gemini-2-5-flash-high",
    // Antigravity variants
    "antigravity-gemini-3-pro": "antigravity-gemini-3-pro-high",
    "antigravity-gemini-3-flash": "antigravity-gemini-3-flash-high",
    "antigravity-gemini-2-5-pro": "antigravity-gemini-2-5-pro-high",
    "antigravity-gemini-2-5-flash": "antigravity-gemini-2-5-flash-high",
    "antigravity-claude-4-6-sonnet": "antigravity-claude-4-6-sonnet-high",
    "antigravity-claude-4-6-opus": "antigravity-claude-4-6-opus-high",
    // GPT-5
    "gpt-5": "gpt-5-high",
    "gpt-5-mini": "gpt-5-mini-high",
    "gpt-5-nano": "gpt-5-nano-high",
    "gpt-5-pro": "gpt-5-pro-high",
    "gpt-5-chat-latest": "gpt-5-chat-latest-high",
    // GPT-5.1/5.2
    "gpt-5-1": "gpt-5-1-high",
    "gpt-5-2": "gpt-5-2-high",
    "gpt-5-2-pro": "gpt-5-2-pro-high",
}

const ALREADY_HIGH = new Set(Object.values(HIGH_VARIANT_MAP))

/**
 * Thinking configurations per provider
 */
export const THINKING_CONFIGS: Record<string, Record<string, unknown>> = {
    anthropic: {
        thinking: {
            type: "enabled",
            budgetTokens: 64000,
        },
        maxTokens: 128000,
    },
    "amazon-bedrock": {
        reasoningConfig: {
            type: "enabled",
            budgetTokens: 32000,
        },
        maxTokens: 64000,
    },
    google: {
        providerOptions: {
            google: {
                thinkingConfig: {
                    thinkingLevel: "HIGH",
                },
            },
        },
    },
    "google-antigravity": {
        providerOptions: {
            google: {
                thinkingConfig: {
                    thinkingLevel: "HIGH",
                },
            },
        },
    },
    openai: {
        reasoning_effort: "high",
    },
}

// Models that support thinking for each provider
const THINKING_CAPABLE_MODELS: Record<string, string[]> = {
    anthropic: ["claude-sonnet-4", "claude-opus-4", "claude-3"],
    "amazon-bedrock": ["claude", "anthropic"],
    google: ["gemini-2", "gemini-3", "gemini-2-5"],
    "google-antigravity": ["gemini-2", "gemini-3", "gemini-2-5", "antigravity-gemini", "antigravity-claude"],
    openai: ["gpt-5", "o1", "o3"],
}

/**
 * Normalize model ID (dots to hyphens in version numbers)
 */
function normalizeModelID(modelID: string): string {
    return modelID.replace(/\.(\d+)/g, "-$1")
}

/**
 * Extract model prefix for custom providers (e.g., "vertex_ai/claude-sonnet")
 */
function extractModelPrefix(modelID: string): { prefix: string; base: string } {
    const slashIndex = modelID.indexOf("/")
    if (slashIndex === -1) {
        return { prefix: "", base: modelID }
    }
    return {
        prefix: modelID.slice(0, slashIndex + 1),
        base: modelID.slice(slashIndex + 1),
    }
}

/**
 * Resolve proxy providers to their underlying provider
 */
function resolveProvider(providerID: string, modelID: string): string {
    // GitHub Copilot proxies to actual providers
    if (providerID === "github-copilot") {
        const modelLower = modelID.toLowerCase()
        if (modelLower.includes("claude")) return "anthropic"
        if (modelLower.includes("gemini")) return "google"
        if (modelLower.includes("gpt") || modelLower.includes("o1") || modelLower.includes("o3")) {
            return "openai"
        }
    }
    return providerID
}

/**
 * Get the high-reasoning variant of a model
 */
export function getHighVariant(modelID: string): string | null {
    const normalized = normalizeModelID(modelID)
    const { prefix, base } = extractModelPrefix(normalized)

    if (ALREADY_HIGH.has(base) || base.endsWith("-high")) {
        return null
    }

    const highBase = HIGH_VARIANT_MAP[base]
    if (!highBase) {
        return null
    }

    return prefix + highBase
}

/**
 * Check if model is already a high-reasoning variant
 */
export function isAlreadyHighVariant(modelID: string): boolean {
    const normalized = normalizeModelID(modelID)
    const { base } = extractModelPrefix(normalized)
    return ALREADY_HIGH.has(base) || base.endsWith("-high")
}

/**
 * Get thinking configuration for a provider/model
 */
export function getThinkingConfig(
    providerID: string,
    modelID: string
): Record<string, unknown> | null {
    const normalized = normalizeModelID(modelID)
    const { base } = extractModelPrefix(normalized)

    if (isAlreadyHighVariant(normalized)) {
        return null
    }

    const resolvedProvider = resolveProvider(providerID, modelID)

    if (!(resolvedProvider in THINKING_CONFIGS)) {
        return null
    }

    const config = THINKING_CONFIGS[resolvedProvider]
    const capablePatterns = THINKING_CAPABLE_MODELS[resolvedProvider]

    if (!capablePatterns) {
        return null
    }

    const baseLower = base.toLowerCase()
    const isCapable = capablePatterns.some((pattern) => baseLower.includes(pattern.toLowerCase()))

    return isCapable ? config : null
}

/**
 * Think Mode state per session
 */
export interface ThinkModeState {
    requested: boolean
    modelSwitched: boolean
    thinkingConfigInjected: boolean
    providerID?: string
    modelID?: string
}

// Track state per session
const thinkModeState = new Map<string, ThinkModeState>()

/**
 * Clear think mode state for a session
 */
export function clearThinkModeState(sessionID: string): void {
    thinkModeState.delete(sessionID)
}

/**
 * Get think mode state for a session
 */
export function getThinkModeState(sessionID: string): ThinkModeState | undefined {
    return thinkModeState.get(sessionID)
}

/**
 * Create the Think Mode hook
 */
export function createThinkModeHook() {
    return {
        /**
         * Hook into chat.params to modify model and inject thinking config
         */
        "chat.params": async (
            output: {
                parts: Array<{ type: string; text?: string }>
                message: {
                    model?: { providerID: string; modelID: string }
                    [key: string]: unknown
                }
            },
            sessionID: string
        ): Promise<void> => {
            const promptText = extractPromptText(output.parts)

            const state: ThinkModeState = {
                requested: false,
                modelSwitched: false,
                thinkingConfigInjected: false,
            }

            // Check for think keywords
            if (!detectThinkKeyword(promptText)) {
                thinkModeState.set(sessionID, state)
                return
            }

            state.requested = true

            const currentModel = output.message.model
            if (!currentModel) {
                thinkModeState.set(sessionID, state)
                return
            }

            state.providerID = currentModel.providerID
            state.modelID = currentModel.modelID

            // Check if already using high variant
            if (isAlreadyHighVariant(currentModel.modelID)) {
                thinkModeState.set(sessionID, state)
                return
            }

            // Try to get high variant
            const highVariant = getHighVariant(currentModel.modelID)
            const thinkingConfig = getThinkingConfig(currentModel.providerID, currentModel.modelID)

            if (highVariant) {
                output.message.model = {
                    providerID: currentModel.providerID,
                    modelID: highVariant,
                }
                state.modelSwitched = true
                log.info("Think mode: model switched to high variant", {
                    sessionID,
                    from: currentModel.modelID,
                    to: highVariant,
                })
            }

            if (thinkingConfig) {
                Object.assign(output.message, thinkingConfig)
                state.thinkingConfigInjected = true
                log.info("Think mode: thinking config injected", {
                    sessionID,
                    provider: currentModel.providerID,
                    config: thinkingConfig,
                })
            }

            thinkModeState.set(sessionID, state)
        },

        /**
         * Clean up state when session is deleted
         */
        event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
            if (event.type === "session.deleted") {
                const props = event.properties as { info?: { id?: string } } | undefined
                if (props?.info?.id) {
                    thinkModeState.delete(props.info.id)
                }
            }
        },
    }
}

export default createThinkModeHook
