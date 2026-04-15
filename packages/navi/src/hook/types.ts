/**
 * Navi Hook System — Lifecycle Event Engine
 *
 * Allows users and plugins to intercept key lifecycle events with:
 *  - Shell command hooks (execute a script)
 *  - HTTP webhook hooks (call an endpoint)
 *  - Function hooks (in-process callbacks)
 *
 * Config is read from .navi/hooks.json or the Navi config.
 */

// ─── Event Types ──────────────────────────────────────────────────────────────

export type HookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "UserPromptSubmit"
  | "SubagentStart"
  | "SubagentStop"
  | "FileChanged"
  | "ConfigChange"

// ─── Hook Definition ──────────────────────────────────────────────────────────

export type CommandHook = {
  type: "command"
  command: string
  /** If provided, only fire for this tool name */
  toolFilter?: string
  /** Timeout in ms (default 30s) */
  timeout?: number
}

export type HttpHook = {
  type: "http"
  url: string
  method?: "POST" | "GET"
  headers?: Record<string, string>
  toolFilter?: string
  timeout?: number
}

export type FunctionHook = {
  type: "function"
  id: string
  fn: (input: HookInput) => Promise<HookOutput | void>
}

export type Hook = CommandHook | HttpHook | FunctionHook

// ─── Hook Config ──────────────────────────────────────────────────────────────

export type HookConfig = {
  [K in HookEvent]?: Hook[]
}

// ─── Hook I/O ─────────────────────────────────────────────────────────────────

export type HookInput = {
  event: HookEvent
  sessionID: string
  cwd: string
  /** Tool name for tool-related events */
  tool?: string
  /** Tool input/output for tool-related events */
  toolInput?: Record<string, unknown>
  toolOutput?: string
  /** Message content for prompt events */
  prompt?: string
  /** Agent name */
  agent?: string
  /** Error message for failure events */
  error?: string
}

export type HookOutput = {
  /** If false, stop the current operation */
  continue?: boolean
  /** Inject text into the system context */
  additionalContext?: string
  /** Show a message to the user */
  systemMessage?: string
  /** Block the operation with this reason */
  blockReason?: string
}
