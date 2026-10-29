/**
 * Headroom AI Context Compression & CCR Layer for Navi
 * Lossy on the wire, lossless end-to-end via CCR (Compress-Cache-Retrieve).
 */

import { native } from "../memory/native"

export interface CompressionOutcome {
  compressed: string
  ccr_key: string | null
  original_len: number
  compressed_len: number
  tokens_saved_est: number
  compression_ratio: number
}

// Fallback in-memory CCR store for pure TypeScript mode
const fallbackCcr = new Map<string, string>()

export function compressContext(
  type: "log" | "diff" | "json" | "code",
  input: string,
  maxParam = 0,
): CompressionOutcome {
  if (!input || input.length < 100) {
    return {
      compressed: input,
      ccr_key: null,
      original_len: input?.length || 0,
      compressed_len: input?.length || 0,
      tokens_saved_est: 0,
      compression_ratio: 1.0,
    }
  }

  if (native.isAvailable && native.headroomCompress) {
    return native.headroomCompress(type, input, maxParam)
  }

  // Pure TypeScript Fallback
  return fallbackCompress(type, input, maxParam)
}

/**
 * Normalizes a CCR key reference into the bare key used by the store.
 *
 * Accepts the bare key ("a611a42849716ce2d0af62d7") or the marker form
 * ("<<ccr:a611a42849716ce2d0af62d7>>"). Only the marker wrapper is stripped;
 * hex digits are preserved verbatim, including "c" and "r".
 */
export function normalizeCcrKey(reference: string): string {
  return reference
    .trim()
    .replace(/^<<ccr:/, "")
    .replace(/>>$/, "")
    .trim()
}

export function retrieveCcr(key: string): string {
  if (!key) return ""

  if (native.isAvailable && native.headroomRetrieve) {
    const res = native.headroomRetrieve(key)
    if (res) return res
  }

  return fallbackCcr.get(key) || ""
}

export function getHeadroomTelemetry(): {
  total_compressions: number
  original_chars: number
  compressed_chars: number
  estimated_tokens_saved: number
  ccr_entries: number
} {
  if (native.isAvailable && native.headroomStats) {
    return native.headroomStats()
  }

  return {
    total_compressions: 0,
    original_chars: 0,
    compressed_chars: 0,
    estimated_tokens_saved: 0,
    ccr_entries: fallbackCcr.size,
  }
}

// ----------------- Pure TypeScript Fallbacks -----------------

function computeSimpleHash(content: string): string {
  let h = 0
  for (let i = 0; i < content.length; i++) {
    h = (Math.imul(31, h) + content.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(16).padStart(8, "0") + "ccr"
}

function fallbackCompress(
  type: "log" | "diff" | "json" | "code",
  input: string,
  maxParam: number,
): CompressionOutcome {
  const origLen = input.length
  const key = computeSimpleHash(input)
  fallbackCcr.set(key, input)

  let compressed = input

  if (type === "log") {
    const lines = input.split("\n")
    if (lines.length > 25) {
      const critical: string[] = []
      for (const line of lines) {
        const up = line.toUpperCase()
        if (
          up.includes("ERROR") ||
          up.includes("FATAL") ||
          up.includes("FAIL") ||
          up.includes("PANIC") ||
          up.includes("EXCEPTION") ||
          up.includes("TRACEBACK")
        ) {
          critical.push(line)
        }
      }
      const kept = [
        ...lines.slice(0, 3),
        `... [${lines.length - critical.length - 6} non-critical log lines pruned | <<ccr:${key}>>]`,
        ...critical.slice(0, 20),
        ...lines.slice(-3),
      ]
      compressed = kept.join("\n")
    }
  } else if (type === "json") {
    try {
      const obj = JSON.parse(input)
      compressed = JSON.stringify(obj)
    } catch {
      compressed = input
    }
  } else if (type === "diff") {
    const lines = input.split("\n")
    if (lines.length > 30) {
      const kept = lines.filter(
        (l) =>
          l.startsWith("diff --git") ||
          l.startsWith("---") ||
          l.startsWith("+++") ||
          l.startsWith("@@") ||
          l.startsWith("+") ||
          l.startsWith("-"),
      )
      compressed = kept.join("\n") + `\n... [context trimmed | <<ccr:${key}>>]`
    }
  }

  const compLen = compressed.length
  const ratio = compLen / (origLen || 1)
  const saved = Math.max(0, Math.floor((origLen - compLen) / 4))

  return {
    compressed,
    ccr_key: key,
    original_len: origLen,
    compressed_len: compLen,
    tokens_saved_est: saved,
    compression_ratio: ratio,
  }
}

export function detectContentType(input: string): "log" | "diff" | "json" | "code" {
  if (!input) return "log"
  const trimmed = input.trim()

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed)
      return "json"
    } catch {
      // not JSON
    }
  }

  if (
    input.includes("diff --git") ||
    input.includes("--- a/") ||
    (input.includes("@@ -") && input.includes("@@"))
  ) {
    return "diff"
  }

  const upper = input.toUpperCase()
  if (
    upper.includes("FATAL") ||
    input.includes("Traceback (most recent call last):") ||
    input.includes("panic:") ||
    input.includes("goroutine ") ||
    upper.includes("[ERROR]") ||
    upper.includes("TEST FAILED") ||
    input.includes("at ") && input.includes(":\d+:\d+")
  ) {
    return "log"
  }

  if (
    input.includes("import ") ||
    input.includes("export ") ||
    input.includes("function ") ||
    input.includes("class ") ||
    input.includes("def ") ||
    input.includes("fn ") ||
    input.includes("interface ") ||
    input.includes("pub fn ")
  ) {
    return "code"
  }

  return "log"
}

export function compressAuto(input: string, minChars = 600): CompressionOutcome {
  if (!input || input.length < minChars) {
    return {
      compressed: input,
      ccr_key: null,
      original_len: input?.length || 0,
      compressed_len: input?.length || 0,
      tokens_saved_est: 0,
      compression_ratio: 1.0,
    }
  }

  const type = detectContentType(input)
  return compressContext(type, input)
}

