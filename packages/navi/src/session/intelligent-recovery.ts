/**
 * Intelligent Session Recovery
 *
 * AI-powered session recovery with summarization and context preservation.
 */

import { Log } from "../util/log";
import { estimateTokens, summarizeLargeResult } from "../util/summarize";
import { MessageV2 } from "./message-v2";

const log = Log.create({ service: "intelligent-recovery" });

/**
 * Recovery context from previous session
 */
export interface RecoveryContext {
    /** Session ID */
    sessionID: string;
    /** Summary of what was being worked on */
    summary: string;
    /** Key files mentioned or edited */
    keyFiles: string[];
    /** Tasks in progress */
    tasksInProgress: string[];
    /** User preferences learned */
    learnedPreferences: string[];
    /** Timestamp of last activity */
    lastActivity: number;
    /** Token count for context */
    tokenCount: number;
}

/**
 * Analyze session messages for recovery context
 */
export function analyzeSessionForRecovery(
    messages: MessageV2.WithParts[],
    maxTokens: number = 8000
): RecoveryContext {
    const context: RecoveryContext = {
        sessionID: "",
        summary: "",
        keyFiles: [],
        tasksInProgress: [],
        learnedPreferences: [],
        lastActivity: Date.now(),
        tokenCount: 0,
    };

    // Extract key information from messages
    const filePattern = /(?:^|\s)([\/\w\.\-\_]+(?:\.\w+)+)(?=\s|$)/g;
    const taskKeywords = ["implement", "create", "build", "fix", "debug", "refactor", "add"];
    const preferenceKeywords = ["prefer", "like", "use", "favorite", "always", "never"];

    for (const message of messages) {
        const content = message.parts
            .filter((p): p is MessageV2.TextPart => p.type === 'text')
            .map(p => p.text)
            .join('\n');

        // Extract file paths
        const fileMatches = content.matchAll(filePattern);
        for (const match of fileMatches) {
            const file = match[1];
            if (file.length > 3 && !file.includes("http") && !file.includes("://")) {
                if (!context.keyFiles.includes(file)) {
                    context.keyFiles.push(file);
                }
            }
        }

        // Extract tasks
        for (const keyword of taskKeywords) {
            if (content.toLowerCase().includes(keyword)) {
                const sentence = extractSentence(content, keyword);
                if (sentence && !context.tasksInProgress.includes(sentence)) {
                    context.tasksInProgress.push(sentence);
                }
            }
        }

        // Extract preferences
        for (const keyword of preferenceKeywords) {
            if (content.toLowerCase().includes(keyword)) {
                const sentence = extractSentence(content, keyword);
                if (sentence && !context.learnedPreferences.includes(sentence)) {
                    context.learnedPreferences.push(sentence);
                }
            }
        }
    }

    // Generate summary
    context.summary = generateRecoverySummary(context);

    // Estimate token count
    const contextText = JSON.stringify(context);
    const estimate = estimateTokens(contextText);
    context.tokenCount = estimate.tokens;

    // If too large, summarize
    if (estimate.exceedsLimit) {
        log.info("Recovery context too large, summarizing...");
        const summarized = summarizeLargeResult(contextText, "Session recovery context");
        context.summary = summarized;
        context.tokenCount = estimateTokens(summarized).tokens;
    }

    log.info("Recovery context analyzed", {
        files: context.keyFiles.length,
        tasks: context.tasksInProgress.length,
        preferences: context.learnedPreferences.length,
        tokens: context.tokenCount,
    });

    return context;
}

/**
 * Extract sentence containing keyword
 */
function extractSentence(text: string, keyword: string): string | null {
    // Better sentence splitting that respects common abbreviations and quoted text
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.toLowerCase().includes(keyword.toLowerCase())) {
            return trimmed;
        }
    }
    return null;
}

/**
 * Generate recovery summary from context
 */
function generateRecoverySummary(context: RecoveryContext): string {
    const parts: string[] = [];

    parts.push("## Session Recovery Summary");

    if (context.keyFiles.length > 0) {
        parts.push("\n### Key Files:");
        for (const file of context.keyFiles.slice(0, 10)) {
            parts.push(`- ${file}`);
        }
    }

    if (context.tasksInProgress.length > 0) {
        parts.push("\n### Tasks in Progress:");
        for (const task of context.tasksInProgress.slice(0, 5)) {
            parts.push(`- ${task}`);
        }
    }

    if (context.learnedPreferences.length > 0) {
        parts.push("\n### Learned Preferences:");
        for (const pref of context.learnedPreferences.slice(0, 5)) {
            parts.push(`- ${pref}`);
        }
    }

    return parts.join("\n");
}

/**
 * Merge recovery contexts
 */
export function mergeRecoveryContexts(
    oldContext: RecoveryContext,
    newContext: RecoveryContext
): RecoveryContext {
    const merged: RecoveryContext = {
        sessionID: newContext.sessionID || oldContext.sessionID,
        summary: newContext.summary || oldContext.summary,
        keyFiles: [...new Set([...oldContext.keyFiles, ...newContext.keyFiles])],
        tasksInProgress: [...new Set([...oldContext.tasksInProgress, ...newContext.tasksInProgress])],
        learnedPreferences: [...new Set([...oldContext.learnedPreferences, ...newContext.learnedPreferences])],
        lastActivity: Math.max(oldContext.lastActivity, newContext.lastActivity),
        tokenCount: oldContext.tokenCount + newContext.tokenCount,
    };

    return merged;
}

/**
 * Create system prompt from recovery context
 */
export function createRecoveryPrompt(context: RecoveryContext): string {
    if (context.keyFiles.length === 0 && context.tasksInProgress.length === 0) {
        return "";
    }

    const parts: string[] = [];

    parts.push("\n\n## Previous Session Context");
    parts.push("You are continuing a previous session. Here's what was happening:");

    if (context.keyFiles.length > 0) {
        parts.push("\n### Files being worked on:");
        for (const file of context.keyFiles.slice(0, 5)) {
            parts.push(`- ${file}`);
        }
    }

    if (context.tasksInProgress.length > 0) {
        parts.push("\n### Tasks in progress:");
        for (const task of context.tasksInProgress.slice(0, 3)) {
            parts.push(`- ${task}`);
        }
    }

    if (context.learnedPreferences.length > 0) {
        parts.push("\n### User preferences learned:");
        for (const pref of context.learnedPreferences.slice(0, 3)) {
            parts.push(`- ${pref}`);
        }
    }

    parts.push("\nPlease continue from where we left off.");

    return parts.join("\n");
}

/**
 * Check if session needs recovery
 */
export function needsRecovery(
    lastActivity: number,
    inactivityThreshold: number = 24 * 60 * 60 * 1000 // 24 hours
): boolean {
    const timeSinceLastActivity = Date.now() - lastActivity;
    return timeSinceLastActivity > inactivityThreshold;
}

/**
 * Suggest recovery actions
 */
export function suggestRecoveryActions(context: RecoveryContext): Array<{ action: string; reason: string }> {
    const suggestions: Array<{ action: string; reason: string }> = [];

    if (context.tasksInProgress.length > 0) {
        suggestions.push({
            action: "Resume tasks in progress",
            reason: `You have ${context.tasksInProgress.length} task(s) that were not completed`,
        });
    }

    if (context.keyFiles.length > 0) {
        suggestions.push({
            action: "Review recently edited files",
            reason: `You were working on ${context.keyFiles.length} file(s)`,
        });
    }

    if (context.learnedPreferences.length > 0) {
        suggestions.push({
            action: "Review learned preferences",
            reason: `I learned ${context.learnedPreferences.length} preference(s) about you`,
        });
    }

    return suggestions;
}



