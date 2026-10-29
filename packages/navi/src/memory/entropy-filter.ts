/**
 * Zero-LLM entropy and repetitive boilerplate filter for observations and memory pages.
 * Port of ai-memory's entropy_filter.rs.
 */

export type SkipReason = "near_empty" | "low_entropy" | "repetitive"

export interface EntropyFilterConfig {
  /** Master switch: if false, keeps everything */
  enabled: boolean
  /** Minimum non-whitespace character count (default: 16) */
  minChars: number
  /** Minimum Shannon entropy in bits per character (default: 2.0) */
  minEntropyBitsPerChar: number
  /** Repetition ratio ceiling: (1 - distinct_tokens / total_tokens) (default: 0.7) */
  maxRepetitionRatio: number
  /** Token floor before repetition ratio check is applied (default: 6) */
  repetitionMinTokens: number
}

export const defaultEntropyFilterConfig: EntropyFilterConfig = {
  enabled: false,
  minChars: 16,
  minEntropyBitsPerChar: 2.0,
  maxRepetitionRatio: 0.7,
  repetitionMinTokens: 6,
}

export interface FilterVerdict {
  keep: boolean
  reason?: SkipReason
}

import { native } from "./native"

/**
 * Calculates Shannon entropy in bits per character over the string's character distribution.
 */
export function shannonBitsPerChar(text: string): number {
  if (native.isAvailable && native.shannonEntropy) {
    return native.shannonEntropy(text)
  }
  if (text.length === 0) return 0.0

  const counts = new Map<string, number>()
  let total = 0
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1)
    total += 1
  }

  if (total === 0) return 0.0

  let bits = 0.0
  for (const count of counts.values()) {
    const p = count / total
    bits -= p * Math.log2(p)
  }

  return bits
}

/**
 * Pure and deterministic classifier for low-information terminal boilerplate.
 */
export function classifyText(text: string, cfg: EntropyFilterConfig = defaultEntropyFilterConfig): FilterVerdict {
  if (!cfg.enabled) {
    return { keep: true }
  }

  if (native.isAvailable && native.classifyEntropy) {
    const code = native.classifyEntropy(
      text,
      cfg.minChars,
      cfg.minEntropyBitsPerChar,
      cfg.maxRepetitionRatio,
      cfg.repetitionMinTokens,
    )
    if (code === 0) return { keep: true }
    if (code === 1) return { keep: false, reason: "near_empty" }
    if (code === 2) return { keep: false, reason: "low_entropy" }
    if (code === 3) return { keep: false, reason: "repetitive" }
  }

  // Near-empty: judged by non-whitespace characters
  const nonWsChars = text.replace(/\s+/g, "").length
  if (nonWsChars < cfg.minChars) {
    return { keep: false, reason: "near_empty" }
  }

  // Low entropy: a single repeated character or tiny alphabet
  const entropy = shannonBitsPerChar(text)
  if (entropy < cfg.minEntropyBitsPerChar) {
    return { keep: false, reason: "low_entropy" }
  }

  // Repetitive: the same handful of tokens over and over
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length >= cfg.repetitionMinTokens) {
    const distinct = new Set(tokens.map((t) => t.toLowerCase())).size
    const repetition = 1.0 - distinct / tokens.length
    if (repetition > cfg.maxRepetitionRatio) {
      return { keep: false, reason: "repetitive" }
    }
  }

  return { keep: true }
}
