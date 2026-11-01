/**
 * Navi Hook Registry
 *
 * Central registry for all hooks. Hooks can come from:
 *  1. `<config>/hooks.json` — user-configured shell/HTTP hooks (always trusted)
 *  2. `<project>/.navi/hooks.json` — project hooks (require explicit trust)
 *  3. Plugins — function hooks registered programmatically
 *  4. Core — built-in hooks from Navi internals
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
 *
 * Trust model:
 *  - Project hooks auto-execute shell commands and HTTP requests, so they only
 *    load after an explicit, user-controlled opt-in: `NAVI_HOOKS_TRUSTED=1`, or
 *    `{ "hooks": { "trusted": true } }` /
 *    `{ "hooks": { "trusted": ["/path/to/project"] } }` in the *user* config.
 *    Untrusted project hooks are logged and skipped.
 *  - User hooks in `<config>/hooks.json` are user-authored and load normally.
 *  - HTTP hooks may not target loopback/private addresses unless the user sets
 *    `NAVI_HOOKS_ALLOW_PRIVATE=1` or `{ "hooks": { "allow_private_network": true } }`.
 *  - Loaded hook configs are scoped per project directory, so opening project A
 *    in the same process never leaks A's hooks into project B. Lookups/events
 *    re-stat the config sources (throttled to ~1s) and reload on change, so
 *    trust revocation and hooks-file edits apply without a restart; a nested
 *    directory with its own hooks file never inherits an ancestor's hooks.
 */

import fs from "fs/promises"
import path from "path"
import { Log } from "@navi-ai/core/util/log"
import { Global } from "../global"
import { ConfigParse } from "../config/parse"
import { Instance } from "../project/instance"
import { environmentFileKeys } from "../permission/network"
import type { HookEvent, HookConfig, Hook, HookInput, FunctionHook } from "./types"
import { runHooks, type AggregatedHookResult } from "./runner"

const log = Log.create({ service: "hook-registry" })

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * How long a loaded state may be reused before its source files are re-stat'ed.
 * Short enough that revocation feels immediate, long enough that a burst of
 * tool calls does not stat the config directory on every event.
 */
const REFRESH_THROTTLE_MS = 1_000

/** User config files that can grant/revoke hook trust (matches load order). */
const TRUST_CONFIG_FILES = ["config.json", "navi.json", "navi.jsonc"] as const

/** Cheap identity for one config source; `null` means the file is absent. */
type FileStamp = string | null

type StateStamps = {
  globalHooks: FileStamp
  projectHooks: FileStamp
  trustConfig: string
}

type EnvSnapshot = {
  trusted?: string
  allowPrivate?: string
}

type HookState = {
  /** The directory this state was loaded for (never an ancestor's key). */
  directory: string
  /** Merged global + (trusted) project hooks for this directory. */
  config: HookConfig
  /** Whether HTTP hooks may reach loopback/private addresses. */
  allowPrivateNetwork: boolean
  /** Source file identity at load time; any mismatch means the state is stale. */
  stamps: StateStamps
  /** Trust switches in the process environment at load time. */
  env: EnvSnapshot
  /** When this state last stat-checked its sources (throttle window). */
  checkedAt: number
}

// Project-scoped hook state, keyed by resolved project directory.
const states = new Map<string, HookState>()

// Per-directory load-once promises (retried after a failed load).
const loading = new Map<string, Promise<void>>()

// Plugin/programmatic function hooks (process-global by design).
const functionHooks = new Map<HookEvent, FunctionHook[]>()

/**
 * Per-directory record of whether the directory declares its own hooks file.
 * Used to stop a state loaded for a broad ancestor directory from applying its
 * hooks to a nested project: the nested project owns (or breaks) the chain.
 */
const nestedHooks = new Map<string, { at: number; hasOwn: boolean }>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDirectory(directory: string): string {
  return path.resolve(directory)
}

function isWithin(parent: string, target: string): boolean {
  const rel = path.relative(parent, target)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function sameDirectory(a: string, b: string): boolean {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

function safeInstanceDirectory(): string | undefined {
  try {
    return Instance.directory
  } catch {
    return undefined
  }
}

/**
 * Find the key of the state that owns `directory`: an exact match, or the
 * longest loaded ancestor (sessions may run in a subdirectory of the project
 * they belong to). A nested directory with its own hooks file never falls back
 * to an ancestor, even when that file is untrusted or fails to parse.
 */
function findStateKey(directory: string): string | undefined {
  const target = normalizeDirectory(directory)
  if (states.has(target)) return target
  if (nestedHooks.get(target)?.hasOwn) return undefined

  let best: string | undefined
  for (const key of states.keys()) {
    if (!isWithin(key, target)) continue
    if (!best || key.length > best.length) best = key
  }
  return best
}

function findState(directory: string): HookState | undefined {
  const key = findStateKey(directory)
  return key === undefined ? undefined : states.get(key)
}

// ─── Staleness Detection ─────────────────────────────────────────────────────

async function fileStamp(filePath: string): Promise<FileStamp> {
  try {
    const stat = await fs.stat(filePath)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
}

async function trustConfigStamp(): Promise<string> {
  const parts = await Promise.all(
    TRUST_CONFIG_FILES.map(async (file) => `${file}=${await fileStamp(path.join(Global.Path.config, file))}`),
  )
  return parts.join("|")
}

async function readStamps(directory: string): Promise<StateStamps> {
  const [globalHooks, projectHooks, trustConfig] = await Promise.all([
    fileStamp(path.join(Global.Path.config, "hooks.json")),
    fileStamp(path.join(directory, ".navi", "hooks.json")),
    trustConfigStamp(),
  ])
  return { globalHooks, projectHooks, trustConfig }
}

function sameStamps(a: StateStamps, b: StateStamps): boolean {
  return a.globalHooks === b.globalHooks && a.projectHooks === b.projectHooks && a.trustConfig === b.trustConfig
}

function envSnapshot(): EnvSnapshot {
  return {
    trusted: process.env.NAVI_HOOKS_TRUSTED,
    allowPrivate: process.env.NAVI_HOOKS_ALLOW_PRIVATE,
  }
}

function sameEnv(a: EnvSnapshot, b: EnvSnapshot): boolean {
  return a.trusted === b.trusted && a.allowPrivate === b.allowPrivate
}

/**
 * Whether `directory` has its own `.navi/hooks.json` (throttled, cached per
 * directory). The negative answer is what makes ancestor fallback safe.
 */
async function ownHooksFile(directory: string, force = false): Promise<boolean> {
  const now = Date.now()
  const cached = nestedHooks.get(directory)
  if (!force && cached && now - cached.at < REFRESH_THROTTLE_MS) return cached.hasOwn

  const hasOwn = (await fileStamp(path.join(directory, ".navi", "hooks.json"))) !== null
  nestedHooks.set(directory, { at: now, hasOwn })
  return hasOwn
}

function truthy(value: string | undefined): boolean {
  if (!value) return false
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
}

// ─── Trust settings (user-controlled) ────────────────────────────────────────

type HookSettings = {
  trusted?: boolean | string[]
  allow_private_network?: boolean
}

/**
 * Read the `hooks` section from the user config files. These live in the
 * user's home directory (never in the project), so they are a safe trust
 * source even when the project itself is attacker-controlled.
 *
 * Deliberately uncached: this only runs during a (throttled) reload, and trust
 * must be re-evaluated every time the config mtime changes so revoking trust
 * takes effect without a restart.
 */
async function hookSettings(): Promise<HookSettings> {
  const directory = Global.Path.config

  let value: HookSettings = {}
  // Match Config's load order: config.json, then navi.json, then navi.jsonc.
  for (const file of TRUST_CONFIG_FILES) {
    const filepath = path.join(directory, file)
    if (!(await Bun.file(filepath).exists())) continue
    const text = await Bun.file(filepath).text()
    if (!text.trim()) continue
    try {
      const data = ConfigParse.jsonc(text, filepath)
      if (!data || typeof data !== "object" || Array.isArray(data)) continue
      const hooks = (data as Record<string, unknown>).hooks
      if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) continue
      value = { ...value, ...(hooks as HookSettings) }
    } catch (err) {
      log.warn("failed to read hooks settings", { path: filepath, err })
    }
  }

  return value
}

/**
 * `NAVI_HOOKS_TRUSTED` is honored only when it comes from the user's
 * environment. Bun auto-loads `.env` files from the working directory, so a
 * repository can otherwise ship `.env` with `NAVI_HOOKS_TRUSTED=1` and have its
 * own hooks treated as trusted.
 */
function envTrustSwitch(name: string, value: string | undefined): boolean {
  if (!truthy(value)) return false
  if (environmentFileKeys().has(name)) {
    log.warn("ignoring trust switch supplied by a project .env file", { name })
    return false
  }
  return true
}

/** Project hooks only load after an explicit, user-controlled opt-in. */
async function projectHooksTrusted(directory: string): Promise<boolean> {
  if (envTrustSwitch("NAVI_HOOKS_TRUSTED", process.env.NAVI_HOOKS_TRUSTED)) return true

  const settings = await hookSettings()
  if (settings.trusted === true) return true
  if (Array.isArray(settings.trusted)) {
    return settings.trusted.some((entry) => typeof entry === "string" && sameDirectory(entry, directory))
  }
  return false
}

async function allowPrivateNetwork(): Promise<boolean> {
  if (envTrustSwitch("NAVI_HOOKS_ALLOW_PRIVATE", process.env.NAVI_HOOKS_ALLOW_PRIVATE)) return true
  return (await hookSettings()).allow_private_network === true
}

// ─── Config Loading ───────────────────────────────────────────────────────────

/**
 * Read one hooks file. A missing or empty file is a normal "no hooks" result;
 * an unreadable or malformed file is a failure so the per-directory load is not
 * cached and the next event retries it (for example after the user fixes a
 * typo).
 */
async function loadHooksFile(filePath: string): Promise<HookConfig> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return {}

  let text: string
  try {
    text = await file.text()
  } catch (err) {
    log.warn("failed to read hooks file", { path: filePath, err })
    throw new Error(`failed to read hooks file: ${filePath}`)
  }
  if (!text.trim()) return {}

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    log.warn("failed to parse hooks file", { path: filePath, err })
    throw new Error(`failed to parse hooks file: ${filePath}`)
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    log.warn("invalid hooks file: expected an object of events", { path: filePath })
    throw new Error(`invalid hooks file: ${filePath}`)
  }
  return data as HookConfig
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
 * Reload hooks from all config sources for one project directory.
 *
 * `directory` defaults to the current instance directory. Pass it explicitly
 * when the caller has an Effect `InstanceRef` but no AsyncLocalStorage
 * context (for example `InstanceBootstrap`).
 */
export async function loadHooks(directory: string = Instance.directory): Promise<void> {
  const dir = normalizeDirectory(directory)
  const globalHooksPath = path.join(Global.Path.config, "hooks.json")
  const projectHooksPath = path.join(dir, ".navi", "hooks.json")
  const stamps = await readStamps(dir)

  // Record ownership before parsing: a nested hooks file that is untrusted or
  // malformed must still stop an ancestor's state from applying here.
  nestedHooks.set(dir, { at: Date.now(), hasOwn: stamps.projectHooks !== null })

  const [globalConfig, trusted, privateNetwork] = await Promise.all([
    loadHooksFile(globalHooksPath),
    projectHooksTrusted(dir),
    allowPrivateNetwork(),
  ])

  const projectConfig = trusted ? await loadHooksFile(projectHooksPath) : {}
  if (!trusted && stamps.projectHooks !== null) {
    log.warn("project hooks skipped: directory is not trusted", {
      path: projectHooksPath,
      hint: "set NAVI_HOOKS_TRUSTED=1 or hooks.trusted in the user config",
    })
  }

  const state: HookState = {
    directory: dir,
    // Project hooks only ever apply to their own directory.
    config: mergeConfigs(globalConfig, projectConfig),
    allowPrivateNetwork: privateNetwork,
    stamps,
    env: envSnapshot(),
    checkedAt: Date.now(),
  }
  states.set(dir, state)

  const totalHooks = Object.values(state.config).reduce((sum, hooks) => sum + (hooks?.length ?? 0), 0)
  log.info("hooks loaded", {
    directory: dir,
    global: Object.values(globalConfig).flat().length,
    project: Object.values(projectConfig).flat().length,
    total: totalHooks,
  })
}

/**
 * Load hooks at most once per project directory.
 *
 * Startup code calls this instead of `loadHooks` so repeated instance
 * bootstraps (multiple projects in one process) do not re-read the config
 * files, while every project still gets its own scoped hook registry. A failed
 * load is not cached, so the next call retries; a missing hooks file is not a
 * failure.
 */
export function loadHooksOnce(directory?: string): Promise<void> {
  const dir = normalizeDirectory(directory ?? Instance.directory)
  const existing = loading.get(dir)
  if (existing) return existing

  const promise = loadHooks(dir).catch((err) => {
    log.warn("failed to initialize hooks", { directory: dir, err })
    loading.delete(dir)
  })
  loading.set(dir, promise)
  return promise
}

/** Reload a directory, failing closed (dropping its hooks) if it no longer parses. */
async function reloadHooks(directory: string): Promise<void> {
  try {
    await loadHooks(directory)
  } catch (err) {
    states.delete(directory)
    log.warn("failed to reload hooks; hooks disabled for this directory", { directory, err })
  }
}

/**
 * Cheap invalidation for hook state. Re-stats the files that produced a state
 * (throttled to `REFRESH_THROTTLE_MS`) and reloads when a source changed, so:
 *
 *  - revoking `hooks.trusted` in the user config takes effect without a restart
 *    (trust is re-evaluated on every reload), and
 *  - editing `.navi/hooks.json` takes effect on the next event.
 *
 * It also stops ancestor fallback at a nested project: if the target directory
 * declares its own hooks file (trusted, untrusted, or malformed) its own state
 * is loaded and the ancestor's hooks never apply to it.
 *
 * `force` bypasses the throttle (used by tests and explicit reloads).
 */
export async function refreshHooks(directory?: string, options?: { force?: boolean }): Promise<void> {
  const resolved = directory ?? safeInstanceDirectory()
  if (resolved === undefined) return

  const dir = normalizeDirectory(resolved)
  const now = Date.now()
  const ownerKey = findStateKey(dir)

  if (ownerKey !== dir) {
    // This directory is not its own state: either it needs one (it has its own
    // hooks file), or it inherits the nearest ancestor's state.
    if (await ownHooksFile(dir, options?.force)) {
      await reloadHooks(dir)
      return
    }
    if (ownerKey === undefined) {
      await loadHooksOnce(dir)
      return
    }
  }

  const owner = ownerKey === undefined ? undefined : states.get(ownerKey)
  if (!owner) {
    await loadHooksOnce(dir)
    return
  }

  if (!options?.force && now - owner.checkedAt < REFRESH_THROTTLE_MS) return
  owner.checkedAt = now

  const stamps = await readStamps(owner.directory)
  if (sameStamps(stamps, owner.stamps) && sameEnv(envSnapshot(), owner.env)) return
  await reloadHooks(owner.directory)
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

function userHooksFor(event: HookEvent, directory?: string): Hook[] {
  const resolved = directory ?? safeInstanceDirectory()
  if (resolved === undefined) {
    // No instance context (tests, embedders): report every loaded directory.
    return [...states.values()].flatMap((state) => (state.config[event] ?? []) as Hook[])
  }
  return (findState(resolved)?.config[event] ?? []) as Hook[]
}

/**
 * Get all hooks registered for a given event.
 */
function getHooksForEvent(event: HookEvent, directory?: string): Hook[] {
  const fns = (functionHooks.get(event) ?? []) as Hook[]
  return [...userHooksFor(event, directory), ...fns]
}

/**
 * Fire all hooks for an event and return aggregated results.
 * Returns null if no hooks are registered for this event.
 */
export async function fire(
  event: HookEvent,
  input: Omit<HookInput, "event">,
): Promise<AggregatedHookResult | null> {
  const dir = normalizeDirectory(input.cwd)
  // Hooks are normally loaded during bootstrap; load lazily for embedders and
  // tests, and re-validate sources (throttled) so edits/revocation are picked
  // up without a restart.
  await refreshHooks(dir)

  const state = findState(dir)
  const hooks = getHooksForEvent(event, dir)
  if (hooks.length === 0) return null

  log.info("firing hooks", { event, directory: dir, count: hooks.length })
  const result = await runHooks(hooks, { ...input, event }, { allowPrivateNetwork: state?.allowPrivateNetwork })
  log.info("hooks completed", { event, shouldContinue: result.shouldContinue })
  return result
}

/**
 * Check if any hooks are registered for a given event.
 * Refreshes the (throttled) hook state first so a revoked trust or an edited
 * hooks file is reflected without a restart.
 */
export async function hasHooks(event: HookEvent, directory?: string): Promise<boolean> {
  const dir = directory ?? safeInstanceDirectory()
  if (dir !== undefined) await refreshHooks(dir)
  return getHooksForEvent(event, dir).length > 0
}

/**
 * List all configured hooks (for /hooks command display).
 */
export async function listHooks(directory?: string): Promise<{ event: string; hooks: Hook[] }[]> {
  const dir = directory ?? safeInstanceDirectory()
  if (dir !== undefined) await refreshHooks(dir)

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
    .map((event) => ({ event, hooks: getHooksForEvent(event, dir) }))
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
): Promise<{ shouldContinue: boolean; additionalContext?: string; blockReason?: string }> {
  const result = await fire("UserPromptSubmit", { sessionID, cwd, prompt, agent })
  if (!result) return { shouldContinue: true }
  return {
    shouldContinue: result.shouldContinue,
    blockReason: result.blockReason,
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
