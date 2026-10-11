/**
 * Pure token estimation and context-window arithmetic primitives.
 * Ported from SpaceXAI Grok Build (xai-token-estimation).
 */

export const BYTES_PER_TOKEN = 4
export const CHARS_PER_TOKEN = 4

/**
 * Per-image approximate token cost when summing low-resolution image patches.
 */
export const IMAGE_TOKEN_ESTIMATE = 765

import { countTokensNative } from "@/native/native-runner"

/**
 * Estimates token count from string length using the standard 4 chars/token heuristic.
 */
export function estimate(input: string): number {
  return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
}

/**
 * Accurate subword token counting.
 * Uses native Rust BPE (cl100k) when available, falling back to 4 chars/token heuristic.
 */
export function countTokens(input: string): number {
  if (!input) return 0
  const native = countTokensNative(input)
  if (native !== null) return native
  return estimate(input)
}

/**
 * Alias for estimate() matching Grok Build API.
 */
export function estimateTokens(input: string): number {
  return estimate(input)
}

/**
 * Inverse of estimate: convert a token budget into a character budget.
 * Used to size passages or system prompt slices against the model's context window.
 */
export function estimateChars(tokens: number): number {
  return Math.max(0, Math.round(tokens * CHARS_PER_TOKEN))
}

/**
 * Token estimate for imageCount images.
 */
export function estimateImageTokens(imageCount: number): number {
  return Math.max(0, Math.round(imageCount * IMAGE_TOKEN_ESTIMATE))
}

/**
 * Usage percentage as a 0-100 float, clamped to 100. Returns 0 when total is 0.
 */
export function usagePercentage(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (used / total) * 100))
}

/**
 * Returns available free tokens clamped to 0.
 */
export function freeTokens(total: number, used: number): number {
  return Math.max(0, total - used)
}

/**
 * Returns true when used >= contextWindow * thresholdPercent / 100.
 * Returns false when contextWindow is 0.
 */
export function exceedsThreshold(used: number, contextWindow: number, thresholdPercent: number): boolean {
  if (contextWindow <= 0) return false
  return used * 100 >= contextWindow * thresholdPercent
}

/**
 * Scaled form of exceedsThreshold minus token headroom.
 * Returns true when used * 100 >= contextWindow * thresholdPercent - headroom * 100.
 */
export function exceedsThresholdWithHeadroom(
  used: number,
  contextWindow: number,
  thresholdPercent: number,
  headroom: number,
): boolean {
  if (contextWindow <= 0) return false
  const targetThreshold = contextWindow * thresholdPercent - headroom * 100
  return used * 100 >= targetThreshold
}

export * as Token from "./token"
