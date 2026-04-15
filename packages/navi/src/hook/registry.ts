/**
 * Navi Hook Registry
 *
 * Central registry for all hooks. Hooks can come from:
 *  1. .navi/hooks.json — user-configured shell/HTTP hooks
 *  2. Plugins — function hooks registered programmatically
 *  3. Core — built-in hooks from Navi internals
 *
 * Config file format (.navi/hooks.json):
 * {
 *   "SessionStart": [
 *     { "type": "command", "command": "echo 'session started'" }
 *   ],
 *   "PreToolUse": [
 *     { "type": "command", "command": "./hooks/pre-tool.sh", "toolFilter": "bash" },
 *     { "type": "http", "url": "http://localhost:9000/hook", "method": "POST" }
 *   ]
 * }
 */

import path from "path"
import { Log } from "../util/log"
import { Global } from "../global"
import { Instance } from "../project/instance"
import type { HookEvent, HookConfig, Hook, HookInput, FunctionHook } from "./types"
import { runHooks, type AggregatedHookResult } from "./runner"

const log = Log.create({ service: "hook-registry" })

// ─── Storage ──────────────────────────────────────────────────────────────────

// User config hooks (from .navi/hooks.json or project .navi/hooks.json)
let userHooks: HookConfig = {}

// Plugin/programmatic function hooks
const functionHooks = new Map<HookEvent, FunctionHook[]>()

// ─── Config Loading ───────────────────────────────────────────────────────────

async function loadHooksFile(filePath: string): Promise<HookConfig> {
  try {
    const file = Bun.file(filePath)
    if (!(await file.exists())) return {}
    const data = await file.json()
    if (typeof data !== "object" || Array.isArray(data)) return {}
    return data as HookConfig
  } catch (err) {
    log.warn("failed to load hooks file", { path: filePath, err })
    return {}
  }
}

function mergeConfigs(...configs: HookConfig[]): HookConfig {
  const merged: HookConfig = {}
  for (const config of configs) {
    for (const [event, hooks] of Object.entries(config)) {
      const key = event as HookEvent
      merged[key] = [...(merged[key] ?? []), ...(hooks ?? [])]
    }
  }
  return merged
}

/**
 * Reload hooks from all config sources.
 * Called at startup and on config change.
 */
export async function loadHooks(): Promise<void> {
  const globalHooksPath = path.join(Global.Path.config, "hooks.json")
  const projectHooksPath = path.join(Instance.directory, ".navi", "hooks.json")

  const [globalConfig, projectConfig] = await Promise.all([
    loadHooksFile(globalHooksPath),
    loadHooksFile(projectHooksPath),
  ])

  // Project hooks override/extend global hooks
  userHooks = mergeConfigs(globalConfig, projectConfig)

  const totalHooks = Object.values(userHooks).reduce((sum, h) => sum + (h?.length ?? 0), 0)
  log.info("hooks loaded", {
    global: Object.values(globalConfig).flat().length,
    project: Object.values(projectConfig).flat().length,
    total: totalHooks,
  })
}

// ─── Function Hook Registration ───────────────────────────────────────────────

/**
 * Register a programmatic function hook.
 * Used by plugins and Navi internals.
 */
export function registerFunctionHook(event: HookEvent, hook: FunctionHook): void {
  if (!functionHooks.has(event)) {
    functionHooks.set(event, [])
  }
  functionHooks.get(event)!.push(hook)
  log.info("function hook registered", { event, id: hook.id })
}

/**
 * Unregister a function hook by ID.
 */
export function unregisterFunctionHook(event: HookEvent, id: string): void {
  const list = functionHooks.get(event)
  if (!list) return
  const idx = list.findIndex((h) => h.id === id)
  if (idx >= 0) list.splice(idx, 1)
}

// ─── Execution ────────────────────────────────────────────────────────────────

/**
 * Get all hooks registered for a given event.
 */
function getHooksForEvent(event: HookEvent): Hook[] {
  const user = (userHooks[event] ?? []) as Hook[]
  const fns = (functionHooks.get(event) ?? []) as Hook[]
  return [...user, ...fns]
}

/**
 * Fire all hooks for an event and return aggregated results.
 * Returns null if no hooks are registered for this event.
 */
export async function fire(
  event: HookEvent,
  input: Omit<HookInput, "event">,
): Promise<AggregatedHookResult | null> {
  const hooks = getHooksForEvent(event)
  if (hooks.length === 0) return null

  log.info("firing hooks", { event, count: hooks.length })
  const result = await runHooks(hooks, { ...input, event })
  log.info("hooks completed", { event, shouldContinue: result.shouldContinue })
  return result
}

/**
 * Check if any hooks are registered for a given event.
 */
export function hasHooks(event: HookEvent): boolean {
  return getHooksForEvent(event).length > 0
}

/**
 * List all configured hooks (for /hooks command display).
 */
export function listHooks(): { event: string; hooks: Hook[] }[] {
  const events: HookEvent[] = [
    "SessionStart",
    "SessionEnd",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "UserPromptSubmit",
    "SubagentStart",
    "SubagentStop",
    "FileChanged",
    "ConfigChange",
  ]

  return events
    .map((event) => ({ event, hooks: getHooksForEvent(event) }))
    .filter(({ hooks }) => hooks.length > 0)
}

// ─── Convenience Helpers ──────────────────────────────────────────────────────

/** Fire SessionStart hooks. */
export async function onSessionStart(sessionID: string, cwd: string, agent?: string) {
  return fire("SessionStart", { sessionID, cwd, agent })
}

/** Fire SessionEnd hooks. */
export async function onSessionEnd(sessionID: string, cwd: string) {
  return fire("SessionEnd", { sessionID, cwd })
}

/** Fire PreToolUse hooks. Returns false if operation should be blocked. */
export async function onPreToolUse(
  sessionID: string,
  cwd: string,
  tool: string,
  toolInput: Record<string, unknown>,
  agent?: string,
): Promise<{ shouldContinue: boolean; blockReason?: string; additionalContext?: string }> {
  const result = await fire("PreToolUse", { sessionID, cwd, tool, toolInput, agent })
  if (!result) return { shouldContinue: true }
  return {
    shouldContinue: result.shouldContinue,
    blockReason: result.blockReason,
    additionalContext: result.additionalContexts.join("\n") || undefined,
  }
}

/** Fire PostToolUse hooks. */
export async function onPostToolUse(
  sessionID: string,
  cwd: string,
  tool: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
  agent?: string,
) {
  return fire("PostToolUse", { sessionID, cwd, tool, toolInput, toolOutput, agent })
}

/** Fire PostToolUseFailure hooks. */
export async function onPostToolUseFailure(
  sessionID: string,
  cwd: string,
  tool: string,
  toolInput: Record<string, unknown>,
  error: string,
  agent?: string,
) {
  return fire("PostToolUseFailure", { sessionID, cwd, tool, toolInput, error, agent })
}

/** Fire UserPromptSubmit hooks. */
export async function onUserPromptSubmit(
  sessionID: string,
  cwd: string,
  prompt: string,
  agent?: string,
): Promise<{ shouldContinue: boolean; additionalContext?: string }> {
  const result = await fire("UserPromptSubmit", { sessionID, cwd, prompt, agent })
  if (!result) return { shouldContinue: true }
  return {
    shouldContinue: result.shouldContinue,
    additionalContext: result.additionalContexts.join("\n") || undefined,
  }
}

/** Fire SubagentStart hooks. */
export async function onSubagentStart(sessionID: string, cwd: string, agent: string) {
  return fire("SubagentStart", { sessionID, cwd, agent })
}

/** Fire SubagentStop hooks. */
export async function onSubagentStop(sessionID: string, cwd: string, agent: string) {
  return fire("SubagentStop", { sessionID, cwd, agent })
}
