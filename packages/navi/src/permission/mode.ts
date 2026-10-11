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

export type PermissionMode = "supervised" | "auto_accept_edits" | "auto" | "full_access"

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

const SHELL_PERMISSIONS = new Set([
  "bash",
  "shell",
  "pwsh",
  "cmd",
  "ptc_eval",
])

class PermissionModeState {
  private currentMode: PermissionMode = "full_access"

  getMode(): PermissionMode {
    return this.currentMode
  }

  setMode(mode: PermissionMode): void {
    this.currentMode = mode
  }

  /**
   * Determines if a tool call requires user approval under the current mode.
   * Returns true if user approval is needed, false if auto-approved.
   */
  requiresApproval(permission: string, _pattern = "*"): boolean {
    const perm = permission.toLowerCase()

    // 1. Full access allows everything without prompting
    if (this.currentMode === "full_access") {
      return false
    }

    // Read-only tools never require approval in any mode
    if (READ_ONLY_PERMISSIONS.has(perm)) {
      return false
    }

    // 2. Auto-accept edits allows file modifications, but gates shell execution
    if (this.currentMode === "auto_accept_edits") {
      if (EDIT_PERMISSIONS.has(perm)) {
        return false
      }
      if (SHELL_PERMISSIONS.has(perm)) {
        return true
      }
      return false
    }

    // 3. Supervised mode gates all mutations and executions
    if (this.currentMode === "supervised") {
      if (EDIT_PERMISSIONS.has(perm) || SHELL_PERMISSIONS.has(perm)) {
        return true
      }
      return true
    }

    // 4. Auto mode: auto-approves safe edits, prompts on shell commands
    if (this.currentMode === "auto") {
      if (SHELL_PERMISSIONS.has(perm)) {
        return true
      }
      return false
    }

    return false
  }
}

export const PermissionModeManager = new PermissionModeState()
