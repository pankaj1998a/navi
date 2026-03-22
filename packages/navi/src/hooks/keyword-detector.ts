/**
 * Keyword Detector Hook for Navi
 *
 * Detects special keywords in user prompts and activates special modes:
 * - "ultrawork" / "ulw" - Activates maximum precision mode with all agents
 * - Search patterns - Activates parallel search mode
 * - Analyze patterns - Activates deep analysis mode
 * - Workflow patterns - Injects task-specific guidance for install/test/lint/build/debug
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
export type KeywordType = "ultrawork" | "search" | "analyze" | "install" | "test" | "lint" | "build" | "debug"

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
- **Documentation & References**: Use researcher agents for API references, external library docs
- **High-IQ Reasoning**: Use architect agent for architecture decisions, code review, strategic planning
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
- researcher agents (remote repos, official docs, GitHub examples)
Plus direct tools: grep, glob, code search
NEVER stop at first result - be exhaustive.`

/**
 * Analyze mode message - deep analysis with context gathering
 */
const ANALYZE_MESSAGE = `[analyze-mode]
ANALYSIS MODE. Gather context before diving deep:

CONTEXT GATHERING (parallel):
- explore agents (codebase patterns, implementations)
- researcher agents (if external library involved)
- Direct tools: grep, code search for targeted searches

IF COMPLEX (architecture, multi-system, debugging after 2+ failures):
- Consult architect agent for strategic guidance

SYNTHESIZE findings before proceeding.`

const INSTALL_MESSAGE = `[install-workflow]
COMMON INSTALL WORKFLOW:
- Inspect the package manager and lockfile before changing dependencies.
- Prefer the repo's existing install command and avoid unrelated upgrades.
- If installation fails, surface the exact failing package, lockfile, or registry step.
- Keep the fix focused and explain whether the issue is dependency resolution, network, permissions, or version mismatch.`

const TEST_MESSAGE = `[test-workflow]
COMMON TEST WORKFLOW:
- Run the smallest relevant test subset first, then expand only if needed.
- Read the failing assertion or stack trace before editing.
- If a test fails, report the file, line, and the next command that is most likely to validate the fix.
- Keep the focus on one failure class at a time.`

const LINT_MESSAGE = `[lint-workflow]
COMMON LINT WORKFLOW:
- Fix the reported rule violations directly and keep the diff minimal.
- Prefer formatting or style-only changes when the failure is purely cosmetic.
- If lint points to multiple files, summarize the shared root cause before editing.
- Avoid unrelated refactors while cleaning lint errors.`

const BUILD_MESSAGE = `[build-workflow]
COMMON BUILD WORKFLOW:
- Treat build failures as compile or packaging regressions, not as generic runtime bugs.
- Read the first real error, then trace the smallest code path that explains it.
- Report the exact file and symbol that most likely need attention.
- If the failure looks cascading, identify the first root error instead of fixing every downstream symptom.`

const DEBUG_MESSAGE = `[debug-workflow]
COMMON DEBUG WORKFLOW:
- Start from the narrowest reproduction you can derive from the failing command.
- Gather logs, stack traces, and the specific code path before editing.
- Prefer one hypothesis per fix cycle and verify after each change.
- If the issue spans multiple layers, localize the first layer that diverges from expected behavior.`

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
    {
        type: "install",
        pattern: /\b(?:bun|npm|pnpm|yarn|pip|poetry|cargo|go|mvn|gradle)\s+(?:install|add|update|upgrade)\b|\binstall(?:ing)?\b(?:.*\bdeps?\b)?/i,
        message: INSTALL_MESSAGE,
    },
    {
        type: "test",
        pattern: /\b(?:bun|npm|pnpm|yarn)\s+(?:test|run\s+test)\b|\bpytest\b|\bcargo\s+test\b|\bgo\s+test\b|\bmvn\s+test\b/i,
        message: TEST_MESSAGE,
    },
    {
        type: "lint",
        pattern: /\b(?:lint|eslint|prettier|ruff|flake8|tsc|typecheck)\b/i,
        message: LINT_MESSAGE,
    },
    {
        type: "build",
        pattern: /\b(?:bun|npm|pnpm|yarn|cargo|go|mvn|gradle|make)\s+(?:build|compile|package)\b|\b(?:build|compile)\b/i,
        message: BUILD_MESSAGE,
    },
    {
        type: "debug",
        pattern: /\bdebug\b|\btroubleshoot\b|\btrace\b|\bcrash\b|\bfailing\b/i,
        message: DEBUG_MESSAGE,
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
