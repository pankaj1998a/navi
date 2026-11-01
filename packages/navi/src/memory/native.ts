/**
 * Native Rust Accelerator for Navi.
 * Loads the compiled `navi_native` cdylib via `bun:ffi` when available.
 * If the native library is missing or unsupported, transparently falls back to
 * pure TypeScript with zero overhead.
 */

import path from "node:path"
import fs from "node:fs"
import type { Pointer } from "bun:ffi"

export interface NativeBinding {
  isAvailable: boolean
  sanitizeText?: (text: string) => string
  shannonEntropy?: (text: string) => number
  classifyEntropy?: (
    text: string,
    minChars: number,
    minEntropy: number,
    maxRepetition: number,
    minTokens: number,
  ) => number
  cosineSimilarity?: (a: Float32Array, b: Float32Array) => number
  validateUrl?: (
    rawUrl: string,
    allowLocalhost?: boolean,
  ) => { safe: boolean; code: number; reason?: string }
  computeDiffStats?: (oldText: string, newText: string) => { additions: number; deletions: number }
  generateUnifiedDiff?: (
    oldText: string,
    newText: string,
    filePath?: string,
    contextLines?: number,
  ) => string
  validateLedger?: (json: string) => { valid: boolean; errors: string[] }
  validateFindings?: (json: string) => { valid: boolean; errors: string[] }
  generateAuditReport?: (findingsJson: string, ledgerJson: string, reportType?: string) => string
  parseAgentFrontmatter?: (
    content: string,
    filePath?: string,
    fallbackId?: string,
  ) => {
    id: string
    name: string
    division: string
    description: string
    color: string
    emoji: string
    vibe: string
    file_path: string
  } | null
  searchAgencyAgents?: (
    catalogJson: string,
    query: string,
    division?: string,
    limit?: number,
  ) => Array<{ agent: any; score: number }>
  analyzeGraph?: (nodesJson: string, edgesJson: string) => any
  affectedGraph?: (nodesJson: string, edgesJson: string, seed: string, depth?: number) => any[]
  shortestPathGraph?: (nodesJson: string, edgesJson: string, from: string, to: string) => any[] | null
  queryGraph?: (nodesJson: string, edgesJson: string, query: string, depth?: number, budget?: number) => string
  generateGraphReport?: (nodesJson: string, edgesJson: string, repoName?: string) => string
  headroomCompress?: (
    type: "log" | "diff" | "json" | "code",
    input: string,
    maxParam?: number,
  ) => {
    compressed: string
    ccr_key: string | null
    original_len: number
    compressed_len: number
    tokens_saved_est: number
    compression_ratio: number
  }
  headroomRetrieve?: (key: string) => string
  headroomStats?: () => {
    total_compressions: number
    original_chars: number
    compressed_chars: number
    estimated_tokens_saved: number
    ccr_entries: number
  }
  snapshotBatchDiff?: (
    items: Array<{ file: string; before: string; after: string; binary?: boolean }>,
  ) => Array<{ file: string; patch: string; additions: number; deletions: number; status: string }>
  snapshotTreeHash?: (dirPath: string) => string
  walkerScan?: (opts: {
    root: string
    max_depth?: number
    extensions?: string[]
    ignore_patterns?: string[]
    max_files?: number
  }) => Array<{ path: string; relative_path: string; is_dir: boolean; size_bytes: number }>
  walkerGrep?: (
    files: string[],
    query: string,
    case_insensitive?: boolean,
    max_matches?: number,
  ) => Array<{ file: string; line_number: number; line_text: string }>
  processRegister?: (pid: number) => boolean
  processKill?: (pid: number) => boolean
}

let binding: NativeBinding = { isAvailable: false }

function findNativeLibraryPath(): string | null {
  const libName =
    process.platform === "win32"
      ? "navi_native.dll"
      : process.platform === "darwin"
        ? "libnavi_native.dylib"
        : "libnavi_native.so"

  const candidateDirs = [
    path.resolve(__dirname, "../../../navi-native/target/debug"),
    path.resolve(__dirname, "../../../navi-native/target/release"),
    path.resolve(__dirname, "../../../../target/release"),
    path.resolve(__dirname, "../../../../target/debug"),
    path.resolve(process.cwd(), "packages/navi-native/target/debug"),
    path.resolve(process.cwd(), "packages/navi-native/target/release"),
  ]

  let newest: { path: string; mtime: number } | null = null
  for (const dir of candidateDirs) {
    const full = path.join(dir, libName)
    if (fs.existsSync(full)) {
      try {
        const stat = fs.statSync(full)
        if (!newest || stat.mtimeMs > newest.mtime) {
          newest = { path: full, mtime: stat.mtimeMs }
        }
      } catch {
        if (!newest) newest = { path: full, mtime: 0 }
      }
    }
  }

  return newest ? newest.path : null
}

try {
  const libPath = findNativeLibraryPath()
  if (libPath && typeof (globalThis as any).Bun !== "undefined") {
    const { dlopen, ptr, toArrayBuffer } = await import("bun:ffi")

    const lib = dlopen(libPath, {
      navi_sanitize: {
        args: ["ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_free_string: {
        args: ["ptr", "usize"],
        returns: "void",
      },
      navi_entropy: {
        args: ["ptr", "usize"],
        returns: "f64",
      },
      navi_classify: {
        args: ["ptr", "usize", "usize", "f64", "f64", "usize"],
        returns: "i32",
      },
      navi_cosine_similarity: {
        args: ["ptr", "ptr", "usize"],
        returns: "f32",
      },
      navi_validate_url: {
        args: ["ptr", "usize", "bool"],
        returns: "i32",
      },
      navi_diff_stats: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "ptr"],
        returns: "i32",
      },
      navi_unified_diff: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "usize", "usize", "ptr"],
        returns: "ptr",
      },
      navi_audit_validate_ledger: {
        args: ["ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_audit_validate_findings: {
        args: ["ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_audit_generate_report: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_agency_parse_frontmatter: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_agency_search: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "usize", "usize", "ptr"],
        returns: "ptr",
      },
      navi_graph_analyze: {
        args: ["ptr", "usize", "ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_graph_affected: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "usize", "usize", "ptr"],
        returns: "ptr",
      },
      navi_graph_path: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "usize", "ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_graph_query: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "usize", "usize", "usize", "ptr"],
        returns: "ptr",
      },
      navi_graph_report: {
        args: ["ptr", "usize", "ptr", "usize", "ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_headroom_compress: {
        args: ["ptr", "usize", "ptr", "usize", "usize", "ptr"],
        returns: "ptr",
      },
      navi_headroom_retrieve: {
        args: ["ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_headroom_stats: {
        args: ["ptr"],
        returns: "ptr",
      },
      navi_snapshot_batch_diff: {
        args: ["ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_snapshot_tree_hash: {
        args: ["ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_walker_scan: {
        args: ["ptr", "usize", "ptr"],
        returns: "ptr",
      },
      navi_walker_grep: {
        args: ["ptr", "usize", "ptr", "usize", "bool", "usize", "ptr"],
        returns: "ptr",
      },
      navi_process_register: {
        args: ["u32"],
        returns: "bool",
      },
      navi_process_kill: {
        args: ["u32"],
        returns: "bool",
      },
    })

    /**
     * Reads a native-allocated string buffer and releases it.
     *
     * Returns `null` when the native call failed (null pointer) and `""` when
     * the native call succeeded but produced an empty payload. The two are
     * distinguished because an empty result is a legitimate outcome (a cache
     * miss, a no-op diff) while a null pointer signals an actual failure.
     */
    const readNativeString = (outPtr: Pointer | null, outLenBuf: BigUint64Array): string | null => {
      if (!outPtr) return null
      const outLen = Number(outLenBuf[0])
      if (outLen === 0) return ""
      const arrayBuf = toArrayBuffer(outPtr, 0, outLen)
      const result = Buffer.from(arrayBuf).toString("utf8")
      lib.symbols.navi_free_string(outPtr, outLen)
      return result
    }

    binding = {
      isAvailable: true,
      sanitizeText: (text: string): string => {
        if (text.length === 0) return ""
        const inputBuf = Buffer.from(text, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_sanitize(ptr(inputBuf), inputBuf.length, ptr(outLenBuf))
        const result = readNativeString(outPtr, outLenBuf)
        if (result === null) return text
        return result
      },
      shannonEntropy: (text: string): number => {
        if (text.length === 0) return 0.0
        const inputBuf = Buffer.from(text, "utf8")
        return lib.symbols.navi_entropy(ptr(inputBuf), inputBuf.length)
      },
      classifyEntropy: (
        text: string,
        minChars: number,
        minEntropy: number,
        maxRepetition: number,
        minTokens: number,
      ): number => {
        if (text.length === 0) return 1 // NearEmpty
        const inputBuf = Buffer.from(text, "utf8")
        return lib.symbols.navi_classify(
          ptr(inputBuf),
          inputBuf.length,
          minChars,
          minEntropy,
          maxRepetition,
          minTokens,
        )
      },
      cosineSimilarity: (a: Float32Array, b: Float32Array): number => {
        if (a.length !== b.length || a.length === 0) return 0
        return lib.symbols.navi_cosine_similarity(ptr(a), ptr(b), a.length)
      },
      validateUrl: (
        rawUrl: string,
        allowLocalhost = false,
      ): { safe: boolean; code: number; reason?: string } => {
        if (!rawUrl) return { safe: false, code: 1, reason: "Empty or invalid URL input" }
        const buf = Buffer.from(rawUrl, "utf8")
        const code = lib.symbols.navi_validate_url(ptr(buf), buf.length, allowLocalhost)
        if (code === 0) return { safe: true, code: 0 }
        const reasons: Record<number, string> = {
          1: "Empty or invalid URL input",
          2: "Target URL contains illegal terminal control characters (CWE-117)",
          3: "Malformed URL syntax",
          4: "Unsupported protocol. Only http: and https: are permitted.",
          5: "URLs with embedded credentials in authority are disallowed",
          6: "Missing hostname in target URL",
          7: "Target points to local or private address",
          8: "Target points to cloud instance metadata service (SSRF protection)",
          9: "Target points to RFC1918 private network",
          10: "Hostname is represented as an obfuscated numeric/hex IP",
        }
        return { safe: false, code, reason: reasons[code] || "Blocked by security policy" }
      },
      computeDiffStats: (
        oldText: string,
        newText: string,
      ): { additions: number; deletions: number } => {
        const oldBuf = Buffer.from(oldText, "utf8")
        const newBuf = Buffer.from(newText, "utf8")
        const addBuf = new BigUint64Array(1)
        const delBuf = new BigUint64Array(1)
        const ret = lib.symbols.navi_diff_stats(
          oldBuf.length > 0 ? ptr(oldBuf) : 0,
          oldBuf.length,
          newBuf.length > 0 ? ptr(newBuf) : 0,
          newBuf.length,
          ptr(addBuf),
          ptr(delBuf),
        )
        if (ret !== 0) return { additions: 0, deletions: 0 }
        return { additions: Number(addBuf[0]), deletions: Number(delBuf[0]) }
      },
      generateUnifiedDiff: (
        oldText: string,
        newText: string,
        filePath = "file",
        contextLines = 3,
      ): string => {
        const oldBuf = Buffer.from(oldText, "utf8")
        const newBuf = Buffer.from(newText, "utf8")
        const fileBuf = Buffer.from(filePath, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_unified_diff(
          oldBuf.length > 0 ? ptr(oldBuf) : 0,
          oldBuf.length,
          newBuf.length > 0 ? ptr(newBuf) : 0,
          newBuf.length,
          fileBuf.length > 0 ? ptr(fileBuf) : 0,
          fileBuf.length,
          contextLines,
          ptr(outLenBuf),
        )
        const result = readNativeString(outPtr, outLenBuf)
        if (result === null) return ""
        return result
      },
      validateLedger: (json: string): { valid: boolean; errors: string[] } => {
        const inputBuf = Buffer.from(json, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_audit_validate_ledger(
          inputBuf.length > 0 ? ptr(inputBuf) : 0,
          inputBuf.length,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) return { valid: false, errors: ["Native audit ledger validator failed"] }
        try {
          return JSON.parse(resultStr)
        } catch {
          return { valid: false, errors: [resultStr] }
        }
      },
      validateFindings: (json: string): { valid: boolean; errors: string[] } => {
        const inputBuf = Buffer.from(json, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_audit_validate_findings(
          inputBuf.length > 0 ? ptr(inputBuf) : 0,
          inputBuf.length,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) return { valid: false, errors: ["Native audit findings validator failed"] }
        try {
          return JSON.parse(resultStr)
        } catch {
          return { valid: false, errors: [resultStr] }
        }
      },
      generateAuditReport: (findingsJson: string, ledgerJson: string, reportType = "main"): string => {
        const fBuf = Buffer.from(findingsJson, "utf8")
        const lBuf = Buffer.from(ledgerJson, "utf8")
        const tBuf = Buffer.from(reportType, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_audit_generate_report(
          fBuf.length > 0 ? ptr(fBuf) : 0,
          fBuf.length,
          lBuf.length > 0 ? ptr(lBuf) : 0,
          lBuf.length,
          tBuf.length > 0 ? ptr(tBuf) : 0,
          tBuf.length,
          ptr(outLenBuf),
        )
        const result = readNativeString(outPtr, outLenBuf)
        if (result === null) return ""
        return result
      },
      parseAgentFrontmatter: (content: string, filePath = "", fallbackId = "agent") => {
        const cBuf = Buffer.from(content, "utf8")
        const pBuf = Buffer.from(filePath, "utf8")
        const idBuf = Buffer.from(fallbackId, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_agency_parse_frontmatter(
          cBuf.length > 0 ? ptr(cBuf) : 0,
          cBuf.length,
          pBuf.length > 0 ? ptr(pBuf) : 0,
          pBuf.length,
          idBuf.length > 0 ? ptr(idBuf) : 0,
          idBuf.length,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) return null
        try {
          return JSON.parse(resultStr)
        } catch {
          return null
        }
      },
      searchAgencyAgents: (catalogJson: string, query: string, division = "", limit = 20) => {
        const catBuf = Buffer.from(catalogJson, "utf8")
        const qBuf = Buffer.from(query, "utf8")
        const divBuf = Buffer.from(division, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_agency_search(
          catBuf.length > 0 ? ptr(catBuf) : 0,
          catBuf.length,
          qBuf.length > 0 ? ptr(qBuf) : 0,
          qBuf.length,
          divBuf.length > 0 ? ptr(divBuf) : 0,
          divBuf.length,
          limit,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) return []
        try {
          return JSON.parse(resultStr)
        } catch {
          return []
        }
      },
      analyzeGraph: (nodesJson: string, edgesJson: string): any => {
        const nBuf = Buffer.from(nodesJson, "utf8")
        const eBuf = Buffer.from(edgesJson, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_graph_analyze(
          ptr(nBuf),
          nBuf.length,
          ptr(eBuf),
          eBuf.length,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) return null
        try {
          return JSON.parse(resultStr)
        } catch {
          return null
        }
      },
      affectedGraph: (nodesJson: string, edgesJson: string, seed: string, depth = 2): any[] => {
        const nBuf = Buffer.from(nodesJson, "utf8")
        const eBuf = Buffer.from(edgesJson, "utf8")
        const sBuf = Buffer.from(seed, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_graph_affected(
          ptr(nBuf),
          nBuf.length,
          ptr(eBuf),
          eBuf.length,
          ptr(sBuf),
          sBuf.length,
          depth,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) return []
        try {
          return JSON.parse(resultStr)
        } catch {
          return []
        }
      },
      shortestPathGraph: (nodesJson: string, edgesJson: string, from: string, to: string): any[] | null => {
        const nBuf = Buffer.from(nodesJson, "utf8")
        const eBuf = Buffer.from(edgesJson, "utf8")
        const fBuf = Buffer.from(from, "utf8")
        const tBuf = Buffer.from(to, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_graph_path(
          ptr(nBuf),
          nBuf.length,
          ptr(eBuf),
          eBuf.length,
          ptr(fBuf),
          fBuf.length,
          ptr(tBuf),
          tBuf.length,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) return null
        try {
          return JSON.parse(resultStr)
        } catch {
          return null
        }
      },
      queryGraph: (nodesJson: string, edgesJson: string, query: string, depth = 3, budget = 2000): string => {
        const nBuf = Buffer.from(nodesJson, "utf8")
        const eBuf = Buffer.from(edgesJson, "utf8")
        const qBuf = Buffer.from(query, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_graph_query(
          ptr(nBuf),
          nBuf.length,
          ptr(eBuf),
          eBuf.length,
          ptr(qBuf),
          qBuf.length,
          depth,
          budget,
          ptr(outLenBuf),
        )
        const result = readNativeString(outPtr, outLenBuf)
        if (result === null) return ""
        return result
      },
      generateGraphReport: (nodesJson: string, edgesJson: string, repoName = "workspace"): string => {
        const nBuf = Buffer.from(nodesJson, "utf8")
        const eBuf = Buffer.from(edgesJson, "utf8")
        const rBuf = Buffer.from(repoName, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_graph_report(
          ptr(nBuf),
          nBuf.length,
          ptr(eBuf),
          eBuf.length,
          ptr(rBuf),
          rBuf.length,
          ptr(outLenBuf),
        )
        const result = readNativeString(outPtr, outLenBuf)
        if (result === null) return ""
        return result
      },
      headroomCompress: (
        type: "log" | "diff" | "json" | "code",
        input: string,
        maxParam = 0,
      ) => {
        const tBuf = Buffer.from(type, "utf8")
        const iBuf = Buffer.from(input, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_headroom_compress(
          tBuf.length > 0 ? ptr(tBuf) : 0,
          tBuf.length,
          iBuf.length > 0 ? ptr(iBuf) : 0,
          iBuf.length,
          maxParam,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) {
          return {
            compressed: input,
            ccr_key: null,
            original_len: input.length,
            compressed_len: input.length,
            tokens_saved_est: 0,
            compression_ratio: 1.0,
          }
        }
        try {
          return JSON.parse(resultStr)
        } catch {
          return {
            compressed: input,
            ccr_key: null,
            original_len: input.length,
            compressed_len: input.length,
            tokens_saved_est: 0,
            compression_ratio: 1.0,
          }
        }
      },
      headroomRetrieve: (key: string): string => {
        const kBuf = Buffer.from(key, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_headroom_retrieve(kBuf.length > 0 ? ptr(kBuf) : 0, kBuf.length, ptr(outLenBuf))
        const result = readNativeString(outPtr, outLenBuf)
        if (result === null) return ""
        return result
      },
      headroomStats: () => {
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_headroom_stats(ptr(outLenBuf))
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (resultStr === null) {
          return {
            total_compressions: 0,
            original_chars: 0,
            compressed_chars: 0,
            estimated_tokens_saved: 0,
            ccr_entries: 0,
          }
        }
        try {
          return JSON.parse(resultStr)
        } catch {
          return {
            total_compressions: 0,
            original_chars: 0,
            compressed_chars: 0,
            estimated_tokens_saved: 0,
            ccr_entries: 0,
          }
        }
      },
      snapshotBatchDiff: (items) => {
        const inputBuf = Buffer.from(JSON.stringify(items), "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_snapshot_batch_diff(
          inputBuf.length > 0 ? ptr(inputBuf) : 0,
          inputBuf.length,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (!resultStr) return []
        try {
          return JSON.parse(resultStr)
        } catch {
          return []
        }
      },
      snapshotTreeHash: (dirPath: string): string => {
        const inputBuf = Buffer.from(dirPath, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_snapshot_tree_hash(
          inputBuf.length > 0 ? ptr(inputBuf) : 0,
          inputBuf.length,
          ptr(outLenBuf),
        )
        const result = readNativeString(outPtr, outLenBuf)
        return result || ""
      },
      walkerScan: (opts) => {
        const inputBuf = Buffer.from(JSON.stringify(opts), "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_walker_scan(
          inputBuf.length > 0 ? ptr(inputBuf) : 0,
          inputBuf.length,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (!resultStr) return []
        try {
          return JSON.parse(resultStr)
        } catch {
          return []
        }
      },
      walkerGrep: (files, query, case_insensitive = true, max_matches = 100) => {
        const fBuf = Buffer.from(JSON.stringify(files), "utf8")
        const qBuf = Buffer.from(query, "utf8")
        const outLenBuf = new BigUint64Array(1)
        const outPtr = lib.symbols.navi_walker_grep(
          fBuf.length > 0 ? ptr(fBuf) : 0,
          fBuf.length,
          qBuf.length > 0 ? ptr(qBuf) : 0,
          qBuf.length,
          case_insensitive,
          max_matches,
          ptr(outLenBuf),
        )
        const resultStr = readNativeString(outPtr, outLenBuf)
        if (!resultStr) return []
        try {
          return JSON.parse(resultStr)
        } catch {
          return []
        }
      },
      processRegister: (pid: number): boolean => {
        return lib.symbols.navi_process_register(pid)
      },
      processKill: (pid: number): boolean => {
        return lib.symbols.navi_process_kill(pid)
      },
    }
  }
} catch {
  binding = { isAvailable: false }
}

export const native = binding
