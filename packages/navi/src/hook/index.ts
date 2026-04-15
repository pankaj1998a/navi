/**
 * Navi Hook System — Public API
 *
 * Usage:
 *   import * as Hook from "@/hook"
 *
 *   // At startup
 *   await Hook.load()
 *
 *   // Fire events
 *   await Hook.onSessionStart(sessionID, cwd)
 *   const { shouldContinue } = await Hook.onPreToolUse(sessionID, cwd, "bash", { command: "..." })
 *
 *   // Register programmatic hooks
 *   Hook.register("PreToolUse", {
 *     type: "function",
 *     id: "security-check",
 *     fn: async (input) => {
 *       if (input.toolInput?.command?.toString().includes("rm -rf /")) {
 *         return { continue: false, blockReason: "Dangerous command blocked" }
 *       }
 *     }
 *   })
 */

export type { HookEvent, HookConfig, Hook, CommandHook, HttpHook, FunctionHook, HookInput, HookOutput } from "./types"
export type { AggregatedHookResult } from "./runner"

export {
  loadHooks,
  registerFunctionHook,
  unregisterFunctionHook,
  fire,
  hasHooks,
  listHooks,
  onSessionStart,
  onSessionEnd,
  onPreToolUse,
  onPostToolUse,
  onPostToolUseFailure,
  onUserPromptSubmit,
  onSubagentStart,
  onSubagentStop,
} from "./registry"

// Aliases for ergonomic use
export { loadHooks as load } from "./registry"
export { registerFunctionHook as register } from "./registry"
export { unregisterFunctionHook as unregister } from "./registry"

export { runHook, runHooks } from "./runner"
