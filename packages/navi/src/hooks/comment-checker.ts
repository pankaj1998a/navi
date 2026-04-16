/**
 * Comment Checker Hook for Navi
 *
 * Detects and warns about excessive or low-quality comments in code changes.
 * Helps prevent "AI slop" - repetitive, obvious, or filler comments.
 *
 * Detection patterns:
 * - Excessive inline comments
 * - Obvious/redundant comments (e.g., "// increment i")
 * - TODO comments left by AI
 * - Comment-to-code ratio too high
 *
 * Ported from oh-my-navi-dev plugin
 */

import type { Hooks } from "@/plugin"
import { Log } from "../util/log"

const log = Log.create({ service: "comment-checker" })

/**
 * Patterns that indicate low-quality/AI-generated comments
 */
const SLOP_PATTERNS = [
    // Obvious comments
    /\/\/\s*(increment|decrement|increase|decrease)\s+(the\s+)?\w+/i,
    /\/\/\s*set\s+\w+\s+to\s+/i,
    /\/\/\s*return\s+(the\s+)?\w+/i,
    /\/\/\s*check\s+if\s+/i,
    /\/\/\s*loop\s+(through|over)\s+/i,
    /\/\/\s*initialize\s+/i,
    /\/\/\s*create\s+(a\s+)?new\s+/i,
    /\/\/\s*call\s+the\s+/i,
    /\/\/\s*get\s+the\s+/i,
    /\/\/\s*update\s+the\s+/i,

    // Filler comments
    /\/\/\s*this\s+(is\s+)?(the\s+)?\w+\s+function/i,
    /\/\/\s*function\s+to\s+/i,
    /\/\/\s*method\s+to\s+/i,
    /\/\/\s*helper\s+(function|method)\s+/i,

    // AI-specific patterns
    /\/\/\s*TODO:\s*(implement|add|fix)\s+later/i,
    /\/\/\s*\.\.\./,
    /\/\/\s*etc\.?/i,
    /\/\/\s*and\s+so\s+on/i,

    // Excessive section markers
    /\/\/\s*={3,}/,
    /\/\/\s*-{3,}/,
    /\/\/\s*#{3,}/,
]

/**
 * Languages that use // comments
 */
const SLASH_COMMENT_LANGS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".go",
    ".java",
    ".c",
    ".cpp",
    ".rs",
    ".swift",
    ".kt",
    ".scala",
])

/**
 * Languages that use # comments
 */
const HASH_COMMENT_LANGS = new Set([".py", ".rb", ".sh", ".yaml", ".yml"])

export interface CommentIssue {
    line: number
    comment: string
    reason: string
}

export interface CommentCheckResult {
    hasIssues: boolean
    issues: CommentIssue[]
    commentRatio: number
    message?: string
}

/**
 * Check content for comment issues
 */
export function checkComments(content: string, filePath: string): CommentCheckResult {
    const ext = filePath.substring(filePath.lastIndexOf("."))
    const lines = content.split("\n")
    const issues: CommentIssue[] = []

    let codeLines = 0
    let commentLines = 0

    // Determine comment pattern based on file extension
    let commentPattern: RegExp | null = null
    if (SLASH_COMMENT_LANGS.has(ext)) {
        commentPattern = /^\s*\/\//
    } else if (HASH_COMMENT_LANGS.has(ext)) {
        commentPattern = /^\s*#/
    }

    if (!commentPattern) {
        return { hasIssues: false, issues: [], commentRatio: 0 }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        if (commentPattern.test(line)) {
            commentLines++

            // Check for slop patterns
            for (const pattern of SLOP_PATTERNS) {
                if (pattern.test(line)) {
                    issues.push({
                        line: i + 1,
                        comment: line,
                        reason: "Potentially redundant or obvious comment",
                    })
                    break
                }
            }
        } else {
            codeLines++
        }
    }

    const totalLines = codeLines + commentLines
    const commentRatio = totalLines > 0 ? commentLines / totalLines : 0

    // Warn if comment ratio is too high (> 40%)
    const hasHighRatio = commentRatio > 0.4 && commentLines > 5

    const hasIssues = issues.length > 0 || hasHighRatio

    let message: string | undefined
    if (hasIssues) {
        const parts: string[] = []
        if (issues.length > 0) {
            parts.push(`Found ${issues.length} potentially redundant comment(s)`)
        }
        if (hasHighRatio) {
            parts.push(`High comment ratio: ${Math.round(commentRatio * 100)}%`)
        }
        message = `⚠️ Comment Check: ${parts.join(". ")}`
    }

    return {
        hasIssues,
        issues,
        commentRatio,
        message,
    }
}

/**
 * Pending tool calls for tracking write/edit operations
 */
interface PendingCall {
    filePath: string
    content?: string
    newContent?: string
    sessionID: string
    timestamp: number
}

const pendingCalls = new Map<string, PendingCall>()
const PENDING_CALL_TTL = 60_000

/**
 * Clean up old pending calls
 */
function cleanupOldPendingCalls(): void {
    const now = Date.now()
    for (const [callID, call] of pendingCalls) {
        if (now - call.timestamp > PENDING_CALL_TTL) {
            pendingCalls.delete(callID)
        }
    }
}

// Start cleanup interval
let cleanupStarted = false

export interface CommentCheckerOptions {
    enabled?: boolean
    warnRatio?: number // Default 0.4
}

/**
 * Create the comment checker hook
 */
export function createCommentCheckerHook(options?: CommentCheckerOptions) {
    const { enabled = true, warnRatio = 0.4 } = options ?? {}

    if (!enabled) {
        return {
            "tool.execute.before": async () => { },
            "tool.execute.after": async () => { },
        }
    }

    // Start cleanup interval
    if (!cleanupStarted) {
        cleanupStarted = true
        setInterval(cleanupOldPendingCalls, 10_000)
    }

    return {
        /**
         * Track write/edit tool calls before execution
         */
        "tool.execute.before": async (
            input: { tool: string; sessionID: string; callID: string },
            output: { args: any }
        ): Promise<void> => {
            const toolLower = input.tool.toLowerCase()

            // Only track write and edit tools
            if (!["write", "edit", "multiedit"].includes(toolLower)) {
                return
            }

            const filePath = (output.args.filePath ??
                output.args.file_path ??
                output.args.path) as string | undefined
            const content = output.args.content as string | undefined
            const newString = (output.args.newString ?? output.args.new_string) as string | undefined

            if (!filePath) return

            pendingCalls.set(input.callID, {
                filePath,
                content,
                newContent: newString,
                sessionID: input.sessionID,
                timestamp: Date.now(),
            })
        },

        /**
         * Check for comment issues after write/edit completion
         */
        "tool.execute.after": async (
            input: { tool: string; sessionID: string; callID: string; args: any },
            output: { title: string; output: string; metadata: any }
        ): Promise<void> => {
            const pendingCall = pendingCalls.get(input.callID)
            if (!pendingCall) return

            pendingCalls.delete(input.callID)

            // Skip if tool execution failed
            const outputLower = output.output.toLowerCase()
            if (
                outputLower.includes("error:") ||
                outputLower.includes("failed to") ||
                outputLower.includes("could not")
            ) {
                return
            }

            // Get content to check
            const contentToCheck = pendingCall.content ?? pendingCall.newContent
            if (!contentToCheck) return

            // Run comment check
            const result = checkComments(contentToCheck, pendingCall.filePath)

            if (result.hasIssues && result.message) {
                log.info("Comment issues detected", {
                    filePath: pendingCall.filePath,
                    issues: result.issues.length,
                    ratio: result.commentRatio,
                })

                // Append warning to output
                output.output += `\n\n${result.message}`

                if (result.issues.length > 0 && result.issues.length <= 3) {
                    output.output += "\nExamples:"
                    for (const issue of result.issues.slice(0, 3)) {
                        output.output += `\n  Line ${issue.line}: ${issue.comment.slice(0, 60)}...`
                    }
                }
            }
        },
    }
}

export default createCommentCheckerHook

