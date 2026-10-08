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
