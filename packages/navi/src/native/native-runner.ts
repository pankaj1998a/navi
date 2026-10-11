import * as path from "path"
import * as fs from "fs"
import { spawnSync } from "child_process"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "native.runner" })

export interface NativePatchResult {
  success: boolean
  modified_files: string[]
  added_files: string[]
  deleted_files: string[]
  diff: string
  error?: string
}

let cachedBinPath: string | null | undefined = undefined

export function getNativeBinaryPath(): string | null {
  if (cachedBinPath !== undefined) {
    return cachedBinPath
  }

  const binaryName = process.platform === "win32" ? "navi-native.exe" : "navi-native"
  const execDir = path.dirname(process.execPath)
  const candidates = [
    path.resolve(execDir, binaryName),
    path.resolve(execDir, "bin", binaryName),
    path.resolve(process.cwd(), "native/navi-native/target/release", binaryName),
    path.resolve(process.cwd(), "../../native/navi-native/target/release", binaryName),
    path.resolve(process.cwd(), "native/navi-native/target/debug", binaryName),
    path.resolve(process.cwd(), "../../native/navi-native/target/debug", binaryName),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      log.info("Found navi-native binary", { path: candidate })
      cachedBinPath = candidate
      return candidate
    }
  }

  cachedBinPath = null
  return null
}

export function isNativeAvailable(): boolean {
  return getNativeBinaryPath() !== null
}

/**
 * Executes high-performance patch application in Rust (adapted from codex-rs/apply-patch).
 * Performs fuzzy sequence matching (seek_sequence) on raw bytes.
 */
export function applyPatchNative(rootDir: string, patchText: string): NativePatchResult | null {
  const bin = getNativeBinaryPath()
  if (!bin) return null

  try {
    const res = spawnSync(bin, ["apply-patch", rootDir], {
      input: patchText,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    })

    if (res.stdout) {
      const parsed = JSON.parse(res.stdout.trim()) as NativePatchResult
      return parsed
    }
    return null
  } catch (err) {
    log.error("Failed to execute native apply-patch", { error: String(err) })
    return null
  }
}

/**
 * Executes high-performance secret scrubbing DFA in Rust (adapted from xai-grok-secrets).
 */
export function scrubSecretsNative(text: string): string | null {
  const bin = getNativeBinaryPath()
  if (!bin) return null

  try {
    const res = spawnSync(bin, ["scrub"], {
      input: text,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    })

    if (res.status === 0 && res.stdout) {
      return res.stdout
    }
    return null
  } catch (err) {
    return null
  }
}

/**
 * Fast line counting in Rust without loading file into V8/Bun memory heap.
 */
export function countLinesNative(filePath: string): number | null {
  const bin = getNativeBinaryPath()
  if (!bin) return null

  try {
    const res = spawnSync(bin, ["line-count", filePath], {
      encoding: "utf-8",
    })

    if (res.status === 0 && res.stdout) {
      const count = parseInt(res.stdout.trim(), 10)
      return isNaN(count) ? null : count
    }
    return null
  } catch {
    return null
  }
}

export interface NativeBinaryResult {
  file: string
  format: string
  architecture: string
  bits: number
  endian: string
  kind: string
  entry_point?: string
  sections_count?: number
  notes: string[]
}

export interface NativeMessagePart {
  type: string
  text?: string
  tool?: string
  status?: string
}

export interface NativeCompactMessage {
  role: string
  parts: NativeMessagePart[]
}

export interface NativeCompactRequest {
  messages: NativeCompactMessage[]
  max_tokens: number
  preserve_recent?: number
}

export interface NativeCompactResponse {
  original_tokens: number
  compacted_tokens: number
  pruned_turns: number
  messages: NativeCompactMessage[]
}

/**
 * Fast BPE token counting in Rust (approximates cl100k without large memory heap).
 */
export function countTokensNative(text: string): number | null {
  const bin = getNativeBinaryPath()
  if (!bin) return null

  try {
    const res = spawnSync(bin, ["bpe-tokens", "--stdin"], {
      input: text,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    })

    if (res.status === 0 && res.stdout) {
      const count = parseInt(res.stdout.trim(), 10)
      return isNaN(count) ? null : count
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fast context-compaction & message pruning in Rust.
 */
export function compactMessagesNative(req: NativeCompactRequest): NativeCompactResponse | null {
  const bin = getNativeBinaryPath()
  if (!bin) return null

  try {
    const res = spawnSync(bin, ["compact", String(req.max_tokens)], {
      input: JSON.stringify(req),
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    })

    if (res.status === 0 && res.stdout) {
      return JSON.parse(res.stdout.trim()) as NativeCompactResponse
    }
    return null
  } catch {
    return null
  }
}

/**
 * High-performance binary executable/archive header inspector in Rust.
 * Analyzes ELF, PE32+, Mach-O, WASM, APK/ZIP, and ASAR headers in microseconds.
 */
export function inspectBinaryNative(filePath: string): NativeBinaryResult | null {
  const bin = getNativeBinaryPath()
  if (!bin) return null

  try {
    const res = spawnSync(bin, ["inspect-binary", filePath], {
      encoding: "utf-8",
    })

    if (res.status === 0 && res.stdout) {
      return JSON.parse(res.stdout.trim()) as NativeBinaryResult
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fast multi-language AST structure extractor in Rust.
 * Extracts symbols and project topology across TS/JS, Rust, Python, Go, and Swift.
 */
export function scanStructureNative(
  targetDir: string,
  options?: { json?: boolean; includeTests?: boolean },
): string | null {
  const bin = getNativeBinaryPath()
  if (!bin) return null

  try {
    const args = ["structure", targetDir]
    if (options?.json) args.push("--json")
    if (options?.includeTests) args.push("--include-tests")

    const res = spawnSync(bin, args, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    })

    if (res.status === 0 && res.stdout) {
      return res.stdout
    }
    return null
  } catch {
    return null
  }
}

