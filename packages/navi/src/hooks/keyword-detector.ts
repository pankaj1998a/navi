/**
 * Keyword Detector Hook for Navi
 *
 * Detects special keywords in user prompts and activates special modes:
 * - "ultrawork" / "ulw" - Activates maximum precision mode with all agents
 * - Search patterns - Activates parallel search mode
 * - Analyze patterns - Activates deep analysis mode
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@navi-ai/plugin"
import { Log } from "../util/log"

const log = Log.create({ service: "keyword-detector" })

// Regex patterns for code blocks (to exclude from detection)
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`[^`]+`/g

/**
 * Keyword detector types
 */
export type KeywordType = "ultrawork" | "search" | "analyze"

export interface DetectedKeyword {
    type: KeywordType
    message: string
}

/**
 * Remove code blocks from text to avoid false positives
 */
function removeCodeBlocks(text: string): string {
    return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

/**
 * Extract prompt text from message parts
 */
function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
    return parts
        .filter((p) => p.type === "text")
        .map((p) => p.text || "")
        .join(" ")
}

/**
 * Ultrawork mode message - maximum precision, all agents at disposal
 */
const ULTRAWORK_MESSAGE = `<ultrawork-mode>

**MANDATORY**: Acknowledge "ULTRAWORK MODE ENABLED!" in your first response.

[CODE RED] Maximum precision required. Think deeply before acting.

## AGENT UTILIZATION PRINCIPLES
- **Codebase Exploration**: Use explore agents for file patterns, project structure
- **Documentation & References**: Use librarian agents for API references, external library docs
- **High-IQ Reasoning**: Use oracle agent for architecture decisions, code review, strategic planning
- **Parallel Execution**: Fire independent agent calls simultaneously - NEVER wait sequentially

## EXECUTION RULES
- **TODO**: Track EVERY step. Mark complete IMMEDIATELY after each.
- **PARALLEL**: Launch multiple agent calls simultaneously for comprehensive coverage.
- **VERIFY**: Re-read request after completion. Check ALL requirements met before reporting done.
- **DELEGATE**: Don't do everything yourself - use specialized agents for their strengths.

## VERIFICATION GUARANTEE
- **NOTHING is "done" without PROOF it works**
- Run tests, verify builds, demonstrate the feature works
- CLAIM NOTHING WITHOUT PROOF. EXECUTE. VERIFY. SHOW EVIDENCE.

## ZERO TOLERANCE FAILURES
- **NO Scope Reduction**: Deliver FULL implementation, not demos or skeletons
- **NO Partial Completion**: Finish 100%, never stop at 60-80%
- **NO Premature Stopping**: Never declare done until ALL TODOs are completed

</ultrawork-mode>

---

`

/**
 * Search mode message - parallel search with multiple agents
 */
const SEARCH_MESSAGE = `[search-mode]
MAXIMIZE SEARCH EFFORT. Launch multiple agents IN PARALLEL:
- explore agents (codebase patterns, file structures)
- librarian agents (remote repos, official docs, GitHub examples)
Plus direct tools: grep, glob, code search
NEVER stop at first result - be exhaustive.`

/**
 * Analyze mode message - deep analysis with context gathering
 */
const ANALYZE_MESSAGE = `[analyze-mode]
ANALYSIS MODE. Gather context before diving deep:

CONTEXT GATHERING (parallel):
- explore agents (codebase patterns, implementations)
- librarian agents (if external library involved)
- Direct tools: grep, code search for targeted searches

IF COMPLEX (architecture, multi-system, debugging after 2+ failures):
- Consult oracle agent for strategic guidance

SYNTHESIZE findings before proceeding.`

/**
 * Keyword patterns and their corresponding messages
 */
const KEYWORD_DETECTORS: Array<{ type: KeywordType; pattern: RegExp; message: string }> = [
    {
        type: "ultrawork",
        pattern: /\b(ultrawork|ulw)\b/i,
        message: ULTRAWORK_MESSAGE,
    },
    {
        type: "search",
        pattern:
            /\b(search|find|locate|lookup|look\s*up|explore|discover|scan|grep|query|browse|detect|trace|seek|track|pinpoint|hunt)\b|where\s+is|show\s+me|list\s+all/i,
        message: SEARCH_MESSAGE,
    },
    {
        type: "analyze",
        pattern:
            /\b(analyze|analyse|investigate|examine|research|study|deep[\s-]?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to/i,
        message: ANALYZE_MESSAGE,
    },
]

/**
 * Detect keywords in text and return their types and messages
 */
export function detectKeywords(text: string): DetectedKeyword[] {
    const textWithoutCode = removeCodeBlocks(text)
    return KEYWORD_DETECTORS.filter(({ pattern }) => pattern.test(textWithoutCode)).map(
        ({ type, message }) => ({ type, message })
    )
}

/**
 * Creates the keyword detector hook
 */
export function createKeywordDetectorHook(): Hooks["chat.message"] {
    return async (
        input: {
            sessionID: string
            agent?: string
            model?: { providerID: string; modelID: string }
            messageID?: string
        },
        output: {
            message: Record<string, unknown>
            parts: Array<{ type: string; text?: string;[key: string]: unknown }>
        }
    ): Promise<void> => {
        const promptText = extractPromptText(output.parts)
        const detectedKeywords = detectKeywords(removeCodeBlocks(promptText))

        if (detectedKeywords.length === 0) {
            return
        }

        // Check for ultrawork mode
        const hasUltrawork = detectedKeywords.some((k) => k.type === "ultrawork")
        if (hasUltrawork) {
            log.info("Ultrawork mode activated", { sessionID: input.sessionID })

            // Set maximum variant for thinking models
            if (output.message.variant === undefined) {
                output.message.variant = "max"
            }
        }

        // Inject context messages for detected keywords
        for (const keyword of detectedKeywords) {
            // Add the keyword message to the output parts
            output.parts.push({
                type: "text",
                text: keyword.message,
            })
        }

        log.info("Detected keywords", {
            sessionID: input.sessionID,
            types: detectedKeywords.map((k) => k.type),
        })
    }
}

export default createKeywordDetectorHook
