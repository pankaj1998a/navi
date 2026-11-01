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
import { Wildcard } from "@/util/wildcard"
import { BashArity } from "./arity"

// ---------------------------------------------------------------------------
// Rule matching — shell commands use prefix/arity matching, paths use globs
// ---------------------------------------------------------------------------

export type PolicyAction = "allow" | "ask" | "deny"

export interface PolicyRule {
  permission: string
  pattern: string
  action: PolicyAction
}

const SHELL_PERMISSIONS = new Set(["bash", "shell", "pwsh", "cmd", "ptc_eval"])

export function isShellPermission(permission: string): boolean {
  return SHELL_PERMISSIONS.has(permission.toLowerCase())
}

/**
 * Split a shell command into rough tokens. This is intentionally lexical: the
 * policy layer only needs a stable prefix, not a full shell parser.
 */
export function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

/**
 * Canonical "human-understandable" command prefix, e.g.
 * `git checkout main` -> `git checkout`, `npm run dev` -> `npm run dev`.
 */
export function commandPrefix(command: string): string {
  return BashArity.prefix(tokenizeCommand(command)).join(" ")
}

/**
 * Match a shell command against a rule pattern.
 *
 * - Glob patterns (`*`, `?`) keep the existing whole-command semantics.
 * - Non-glob patterns match by token prefix, so `git checkout` matches
 *   `git checkout main` and `rm` matches `rm -rf /`.
 */
export function matchesCommand(command: string, pattern: string): boolean {
  if (Wildcard.match(command, pattern)) return true
  if (/[*?]/.test(pattern)) return false

  const tokens = tokenizeCommand(command)
  if (tokens.length === 0) return false

  const prefix = commandPrefix(command)
  if (prefix && Wildcard.match(prefix, pattern)) return true

  const patternTokens = pattern.trim().split(/\s+/).filter(Boolean)
  if (patternTokens.length === 0 || patternTokens.length > tokens.length) return false
  return patternTokens.every((token, index) => Wildcard.match(tokens[index]!, token))
}

/**
 * Match a rule pattern for any permission. Shell permissions get prefix/arity
 * matching; everything else keeps glob matching.
 */
export function matchesPattern(permission: string, target: string, pattern: string): boolean {
  if (isShellPermission(permission)) return matchesCommand(target, pattern)
  return Wildcard.match(target, pattern)
}

/**
 * Collapse the matched actions into a single decision using precedence:
 * deny > ask > allow > fallback (the mode default).
 */
export function decide(actions: ReadonlyArray<PolicyAction>, fallback: PolicyAction = "ask"): PolicyAction {
  if (actions.includes("deny")) return "deny"
  if (actions.includes("ask")) return "ask"
  if (actions.includes("allow")) return "allow"
  return fallback
}

/**
 * Pure decision used by the runtime ask flow. `matches` contains the action of
 * the last matching explicit rule per pattern, or `undefined` when the pattern
 * has no explicit rule (i.e. the mode default should apply).
 */
export function resolveAskOutcome(input: {
  readonly matches: ReadonlyArray<PolicyAction | undefined>
  readonly modeRequiresApproval: boolean
}): PolicyAction {
  if (input.matches.some((action) => action === "deny")) return "deny"
  if (input.matches.some((action) => action === "ask")) return "ask"
  if (input.matches.length > 0 && input.matches.every((action) => action === "allow")) return "allow"
  return input.modeRequiresApproval ? "ask" : "allow"
}

/**
 * Find the last matching rule, then let `decide` apply precedence across all
 * matching rules. This is a policy helper; the core `Permission.evaluate`
 * keeps config-order (last match wins) semantics for compatibility.
 */
export function evaluate(
  permission: string,
  target: string,
  rulesets: ReadonlyArray<ReadonlyArray<PolicyRule>>,
  fallback: PolicyAction = "ask",
): { action: PolicyAction; rule?: PolicyRule } {
  const matching = rulesets.flat().filter(
    (rule) => Wildcard.match(permission, rule.permission) && matchesPattern(permission, target, rule.pattern),
  )
  return { action: decide(matching.map((rule) => rule.action), fallback), rule: matching[matching.length - 1] }
}

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
    deny: [
      "rm -rf /",
      "rm -rf /*",
      "rm -rf ~",
      "rm -rf ~/*",
      ":(){ :|:& };:",
      "mkfs*",
      "dd if=/dev/zero*",
      "dd if=/dev/urandom*",
    ] as string[],
    ask: ["sudo *", "su *", "chmod -R 777 *"] as string[],
  },
  pwsh: {
    allow: ["*"] as const,
    deny: [
      "Remove-Item -Recurse -Force C:\\*",
      "Remove-Item -Recurse -Force /",
      "format *",
      "diskpart*",
    ] as string[],
    ask: ["*.ps1", "Set-ExecutionPolicy *"] as string[],
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
