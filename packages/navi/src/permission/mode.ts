/**
 * 4-Tier Permission Matrix for Navi.
 * Inspired by T3 Code (permission-modes.md) & Claude Code:
 *
 * 1. "supervised": Requests approval for all commands and file changes.
 * 2. "auto_accept_edits": Approves file edits automatically; shell commands require approval.
 * 3. "auto": Automatic heuristic review (safe operations auto-approved; destructive commands prompt).
 * 4. "full_access": Allows commands and edits without approval prompts.
 *
 * @module @navi/permission/mode
 */
import path from "node:path"
import { Instance } from "@/project/instance"

export type PermissionMode = "supervised" | "auto_accept_edits" | "auto" | "full_access"

/**
 * Approval mode used when config does not specify `permission.mode`.
 * Security-sensitive default: prompt for anything that mutates state.
 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "supervised"

const PERMISSION_MODES: ReadonlySet<string> = new Set([
  "supervised",
  "auto_accept_edits",
  "auto",
  "full_access",
])

const READ_ONLY_PERMISSIONS = new Set([
  "read",
  "glob",
  "grep",
  "lsp",
  "codesearch",
  "knowledge",
  "memory",
  "history",
  "arch_map",
  "reverse_js",
  "reverse_managed",
  "reverse_apk",
  "reverse_evm",
  "reverse_firmware",
  "reverse_native",
  "reverse_apple",
  "reverse_web",
  "reverse_doctor",
  "spill_read",
  "websearch",
  "webscrape",
  "webcrawl",
  "fetch",
])

const EDIT_PERMISSIONS = new Set([
  "write",
  "edit",
  "patch",
  "apply_patch",
  "todowrite",
  "deliverable",
  "present_deliverable",
  "trash",
  "magic_docs",
])

const SHELL_PERMISSIONS = new Set(["bash", "shell", "pwsh", "cmd", "ptc_eval"])

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && PERMISSION_MODES.has(value)
}

export function isReadOnlyPermission(permission: string): boolean {
  return READ_ONLY_PERMISSIONS.has(permission.toLowerCase())
}

/**
 * Resolve a configured mode (which may come from untyped JSON) to a known
 * mode. Invalid or missing values fall back to `supervised`.
 */
export function resolvePermissionMode(input?: { readonly mode?: unknown } | string | null): PermissionMode {
  const value = typeof input === "string" ? input : input?.mode
  return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE
}

function scopeKey(scope: string): string {
  const resolved = path.resolve(scope)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/** Current instance directory when called inside an instance, else undefined. */
function currentScope(): string | undefined {
  try {
    return Instance.current.directory
  } catch {
    return undefined
  }
}

class PermissionModeState {
  private currentMode: PermissionMode = DEFAULT_PERMISSION_MODE
  // Instance/directory scoped modes. The CLI is single-project, but the server
  // and TUI can open several directories in one process; a process-global mode
  // would leak `full_access` from one instance into another.
  private readonly scopedModes = new Map<string, PermissionMode>()

  getMode(scope?: string): PermissionMode {
    const effective = scope ?? currentScope()
    if (effective !== undefined) {
      const scoped = this.scopedModes.get(scopeKey(effective))
      if (scoped !== undefined) return scoped
    }
    return this.currentMode
  }

  /**
   * Idempotent and safe: invalid runtime values are ignored so a bad config
   * cannot accidentally downgrade enforcement.
   */
  setMode(mode: PermissionMode, scope?: string): void {
    if (!isPermissionMode(mode)) return
    if (scope !== undefined) {
      this.scopedModes.set(scopeKey(scope), mode)
      return
    }
    this.currentMode = mode
  }

  clearScope(scope: string): void {
    this.scopedModes.delete(scopeKey(scope))
  }

  /**
   * Determines if a tool call requires user approval under the current mode.
   * Returns true if user approval is needed, false if auto-approved.
   */
  requiresApproval(permission: string, _pattern = "*", scope?: string): boolean {
    const perm = permission.toLowerCase()
    // Resolve the instance-scoped mode; a process-global read would let one
    // open project's `full_access` auto-approve another project's tools.
    const mode = this.getMode(scope)

    // 1. Full access allows everything without prompting
    if (mode === "full_access") {
      return false
    }

    // Read-only tools never require approval in any mode
    if (isReadOnlyPermission(perm)) {
      return false
    }

    // 2. Auto-accept edits allows file modifications, but gates shell execution
    if (mode === "auto_accept_edits") {
      if (EDIT_PERMISSIONS.has(perm)) {
        return false
      }
      if (SHELL_PERMISSIONS.has(perm)) {
        return true
      }
      return false
    }

    // 3. Supervised mode gates all mutations and executions
    if (mode === "supervised") {
      if (EDIT_PERMISSIONS.has(perm) || SHELL_PERMISSIONS.has(perm)) {
        return true
      }
      return true
    }

    // 4. Auto mode: auto-approves safe edits, prompts on shell commands
    if (mode === "auto") {
      if (SHELL_PERMISSIONS.has(perm)) {
        return true
      }
      return false
    }

    return false
  }
}

export const PermissionModeManager = new PermissionModeState()

/**
 * Apply a mode coming from config or a CLI flag.
 *
 * `scope` is the instance directory. When given, the mode only applies to that
 * directory so opening another project cannot inherit `full_access`. Without a
 * scope the process-global default is set (used by tests and CLI flags).
 */
export function setPermissionMode(
  input?: string | { readonly mode?: unknown } | null,
  scope?: string,
): PermissionMode {
  const mode = resolvePermissionMode(input)
  PermissionModeManager.setMode(mode, scope)
  return mode
}

export * as PermissionModeModule from "./mode"
