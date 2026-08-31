/**
 * Fast calibrated token estimator for LLMs (Claude / GPT / DeepSeek).
 * Accurately models subword segmentation, punctuation/code tokens, and CJK characters.
 */
export function estimate(input: string): number {
  if (!input) return 0

  let tokens = 0
  let i = 0
  const len = input.length

  while (i < len) {
    const code = input.charCodeAt(i)

    // CJK Unified Ideographs & Hangul (each char is ~1.5 tokens on modern BPE tokenizers)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      tokens += 1.5
      i++
      continue
    }

    // Whitespace runs (consecutive spaces/tabs often group into 1 token per 3-4 spaces)
    if (code === 32 || code === 9 || code === 10 || code === 13) {
      let wsLen = 0
      while (
        i < len &&
        (input.charCodeAt(i) === 32 ||
          input.charCodeAt(i) === 9 ||
          input.charCodeAt(i) === 10 ||
          input.charCodeAt(i) === 13)
      ) {
        wsLen++
        i++
      }
      tokens += Math.ceil(wsLen / 3)
      continue
    }

    // Numbers (digits group into 1 token per 2-3 digits)
    if (code >= 48 && code <= 57) {
      let numLen = 0
      while (i < len && input.charCodeAt(i) >= 48 && input.charCodeAt(i) <= 57) {
        numLen++
        i++
      }
      tokens += Math.ceil(numLen / 2.5)
      continue
    }

    // Letters (English words average ~3.7 characters per token)
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95) {
      let wordLen = 0
      while (
        i < len &&
        ((input.charCodeAt(i) >= 65 && input.charCodeAt(i) <= 90) ||
          (input.charCodeAt(i) >= 97 && input.charCodeAt(i) <= 122) ||
          input.charCodeAt(i) === 95)
      ) {
        wordLen++
        i++
      }
      tokens += Math.max(1, Math.ceil(wordLen / 3.7))
      continue
    }

    // Punctuation and code operators
    tokens += 1
    i++
  }

  return Math.ceil(tokens)
}

/**
 * Estimates tokens for arbitrary structured JSON values without full JSON.stringify string allocations.
 */
export function estimateValue(val: unknown): number {
  if (val === null || val === undefined) return 1
  if (typeof val === "boolean" || typeof val === "number") return 1
  if (typeof val === "string") return estimate(val)
  if (Array.isArray(val)) {
    let sum = 2 // array brackets
    for (const item of val) {
      sum += estimateValue(item) + 1 // comma
    }
    return sum
  }
  if (typeof val === "object") {
    let sum = 2 // object braces
    for (const [key, v] of Object.entries(val as Record<string, unknown>)) {
      sum += estimate(key) + 1 + estimateValue(v) + 1
    }
    return sum
  }
  return 1
}

export * as Token from "./token"
