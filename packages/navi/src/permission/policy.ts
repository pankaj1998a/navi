/**
 * Permission policy split for shell (bash/pwsh) and filesystem.
 * Inspired by deepseek-harness:
 * - packages/shell/tool-bash and tool-pwsh (separate validation/policy)
 * - packages/fs/fs-observation-policy and fs-sandbox/containment
 *
 * This stub centralizes the future policy surface without changing runtime
 * enforcement yet; per-agent merging happens in Agent layer.
 *
 * @module @navi/permission/policy
 */
import { sep, resolve, isAbsolute, relative } from "node:path"

// ---------------------------------------------------------------------------
// Shell policy — mirrors deepseek tool-bash / tool-pwsh split
// ---------------------------------------------------------------------------

/**
 * Per-shell allow/ask/deny lists. Bash is permissive by default; pwsh gates
 * script files behind an ask. Consumers merge this with agent permission rules.
 */
export const ShellPolicy = {
  bash: {
    allow: ["*"] as const,
    deny: [] as string[],
    ask: [] as string[],
  },
  pwsh: {
    allow: ["*"] as const,
    deny: [] as string[],
    ask: ["*.ps1"] as const,
  },
} as const

export type ShellKind = keyof typeof ShellPolicy
export type ShellPolicyEntry = (typeof ShellPolicy)[ShellKind]

// ---------------------------------------------------------------------------
// FS policy — stub path-traversal guard inspired by deepseek fs-sandbox
// ---------------------------------------------------------------------------

/**
 * Lexical containment check — fast path from fs-sandbox/containment.ts
 * Returns true if `target` is `root` or lies beneath it lexically.
 * Case sensitivity defaults to platform convention (case-insensitive on win32).
 */
export function isLexicallyUnder(
  target: string,
  root: string,
  caseSensitive = process.platform !== "win32",
): boolean {
  const cmp = (p: string) => (caseSensitive ? p : p.toLowerCase())
  const t = cmp(target)
  const r = cmp(root)
  if (t === r) return true
  const prefix = r.endsWith(sep) ? r : r + sep
  return t.startsWith(prefix)
}

/**
 * Detect path traversal attempts. Rejects:
 * - embedded `..` segments after resolve
 * - null bytes
 * - absolute path escaping outside expected root when root given
 */
export function isPathTraversalAttempt(input: string): boolean {
  if (input.includes("\0")) return true
  // Any `..` segment after normalization is suspicious if it escapes.
  const normalized = input.replace(/\\/g, "/")
  if (/(^|\/)\.\.(\/|$)/.test(normalized)) return true
  return false
}

/**
 * Guard that throws on traversal. Mirrors fs-sandbox checkedTarget fail-closed.
 * Call before any fs operation that touches model-controlled paths.
 */
export function assertNoTraversal(displayPath: string, workspaceRoot?: string): string {
  if (displayPath.includes("\0")) {
    throw new Error(`path traversal denied: null byte in "${displayPath}"`)
  }
  const resolved = isAbsolute(displayPath)
    ? resolve(displayPath)
    : workspaceRoot
      ? resolve(workspaceRoot, displayPath)
      : resolve(displayPath)

  if (workspaceRoot) {
    const root = resolve(workspaceRoot)
    if (!isLexicallyUnder(resolved, root)) {
      // Fallback would be identity check (stat dev/ino) on real FS — stub keeps lexical.
      throw new Error(`path traversal denied: "${displayPath}" escapes workspace root`)
    }
  }

  if (isPathTraversalAttempt(relative(workspaceRoot ?? "/", resolved))) {
    throw new Error(`path traversal denied: "${displayPath}" contains ".." escape`)
  }

  return resolved
}

/**
 * FS policy surface — mirrors fs-observation-policy / fs-sandbox split:
 * - read: always allowed
 * - write/edit: must pass traversal guard + optional containment under writable roots
 */
export const FsPolicy = {
  isLexicallyUnder,
  isPathTraversalAttempt,
  assertNoTraversal,
  /**
   * Check if a canonical target is allowed under the given writable roots.
   * Stub of fs-sandbox's writableRoots + isPathUnder loop.
   */
  isAllowedUnderRoots(targetKey: string, writableRoots: string[]): boolean {
    for (const root of writableRoots) {
      if (isLexicallyUnder(targetKey, resolve(root))) return true
    }
    return false
  },
} as const

export * as Policy from "./policy"
