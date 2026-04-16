/**
 * Think Mode Hook for Navi
 *
 * Automatically detects thinking keywords in prompts and upgrades models
 * to their high-reasoning variants with extended thinking budgets.
 */

import type { Hooks } from "@/plugin"
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

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`[^`]+`/g

function removeCodeBlocks(text: string): string {
    return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

export function detectThinkKeyword(text: string): boolean {
    const textWithoutCode = removeCodeBlocks(text)
    return THINK_PATTERNS.some((pattern) => pattern.test(textWithoutCode))
}

function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
    return parts
        .filter((p) => p.type === "text")
        .map((p) => p.text || "")
        .join("")
}

const HIGH_VARIANT_MAP: Record<string, string> = {
    "claude-sonnet-4-5": "claude-sonnet-4-5-high",
    "claude-opus-4-5": "claude-opus-4-5-high",
    "gemini-3-pro": "gemini-3-pro-high",
    "gemini-3-pro-preview": "gemini-3-pro-preview-high",
    "gemini-3-flash": "gemini-3-flash-high",
    "gemini-2-5-pro": "gemini-2-5-pro-high",
    "gemini-2-5-flash": "gemini-2-5-flash-high",
    "gpt-5": "gpt-5-high",
}

const ALREADY_HIGH = new Set(Object.values(HIGH_VARIANT_MAP))

export function getHighVariant(modelID: string): string | null {
    if (ALREADY_HIGH.has(modelID) || modelID.endsWith("-high")) return null
    return HIGH_VARIANT_MAP[modelID] || null
}

const THINKING_CONFIGS: Record<string, Record<string, unknown>> = {
    anthropic: {
        thinking: { type: "enabled", budgetTokens: 64000 },
        maxTokens: 128000,
    },
    google: {
        providerOptions: { google: { thinkingConfig: { thinkingLevel: "HIGH" } } }
    },
    openai: { reasoning_effort: "high" },
}

export function getThinkingConfig(providerID: string): Record<string, unknown> | null {
    return THINKING_CONFIGS[providerID] || null
}


export interface ThinkModeState {
    requested: boolean
    modelSwitched: boolean
}

const thinkModeState = new Map<string, ThinkModeState>()

export function createThinkModeHook(): Hooks {
    return {
        "chat.message": async (input, output) => {
            const promptText = extractPromptText(output.parts)
            if (!detectThinkKeyword(promptText)) return

            const currentModel = output.message.model
            if (!currentModel) return

            const highVariant = getHighVariant(currentModel.modelID)
            if (highVariant) {
                output.message.model = {
                    providerID: currentModel.providerID,
                    modelID: highVariant,
                }
                log.info("Think mode: model switched to high variant", { 
                    sessionID: input.sessionID, 
                    to: highVariant 
                })
            }
            
            thinkModeState.set(input.sessionID, { requested: true, modelSwitched: !!highVariant })
        },

        "chat.params": async (input, output) => {
            const state = thinkModeState.get(input.sessionID)
            if (!state?.requested) return

            const config = THINKING_CONFIGS[input.provider.info.id] || THINKING_CONFIGS[input.model.providerID]
            if (config) {
                Object.assign(output.options, config)
                log.info("Think mode: thinking config injected", { sessionID: input.sessionID })
            }
        },

        event: async ({ event }) => {
            if (event.type === "session.deleted") {
                const id = (event.properties as any)?.info?.id
                if (id) thinkModeState.delete(id)
            }
        }
    }
}

export default createThinkModeHook
