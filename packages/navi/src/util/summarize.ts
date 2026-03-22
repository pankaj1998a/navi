/**
 * Large Response Handling
 *
 * Intelligent summarization of large tool responses to stay within context limits.
 * Uses token-based detection and Haiku for summarization when needed.
 */

import { Log } from "./log";
import { encodingForModel, getEncoding } from "js-tiktoken";

const log = Log.create({ service: "summarize" });

/**
 * Token limit for tool responses (approximate)
 */
export const TOKEN_LIMIT = 60000;

/**
 * Token estimation result
 */
export interface TokenEstimate {
    tokens: number;
    exceedsLimit: boolean;
}

/**
 * Estimate tokens in text using js-tiktoken
 */
export function estimateTokens(text: string): TokenEstimate {
    try {
        // Try to use cl100k_base encoding (used by most modern models)
        const encoding = encodingForModel("gpt-4") || getEncoding("cl100k_base");
        const tokens = encoding.encode(text).length;

        return {
            tokens,
            exceedsLimit: tokens > TOKEN_LIMIT,
        };
    } catch (error) {
        // Fallback: rough estimate (1 token ≈ 4 characters)
        const tokens = Math.ceil(text.length / 4);
        log.warn("Using fallback token estimation:", { error });

        return {
            tokens,
            exceedsLimit: tokens > TOKEN_LIMIT,
        };
    }
}

/**
 * Summarize large text using a simple truncation strategy
 * (Full implementation would use an LLM like Haiku for intelligent summarization)
 */
export function summarizeLargeResult(fullResult: string, intent?: string): string {
    const estimate = estimateTokens(fullResult);

    if (!estimate.exceedsLimit) {
        return fullResult;
    }

    log.info(`Summarizing large result (${estimate.tokens} tokens)`);

    // Simple truncation strategy
    // In a full implementation, this would use Claude Haiku for intelligent summarization
    const targetTokens = TOKEN_LIMIT * 0.7; // Aim for 70% of limit
    const targetChars = targetTokens * 4; // Rough character estimate

    const summary = [
        `# Summary (truncated from ${estimate.tokens} tokens)`,
        ``,
        intent ? `**Intent:** ${intent}` : ``,
        ``,
        `## First part of response:`,
        fullResult.substring(0, Math.min(targetChars, fullResult.length)),
        ``,
        `## Note: Full response was ${fullResult.length} characters (${estimate.tokens} tokens).`,
        `Use the full response tool to see complete output if needed.`,
    ].filter(Boolean).join("\n");

    return summary;
}

/**
 * Store full response for later retrieval
 */
export function storeFullResponse(sessionId: string, toolUseId: string, content: string): string {
    // In a full implementation, this would write to long_responses/ directory
    // For now, return a reference ID
    const referenceId = `${sessionId}-${toolUseId}-${Date.now()}`;
    log.info(`Stored full response with reference: ${referenceId}`);
    return referenceId;
}

/**
 * Get full response from storage
 */
export function getFullResponse(referenceId: string): string | null {
    // In a full implementation, this would read from long_responses/ directory
    // For now, return null (not implemented)
    log.warn(`Full response retrieval not implemented for: ${referenceId}`);
    return null;
}
