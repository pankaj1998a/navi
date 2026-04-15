/**
 * Navi Hook Runner
 *
 * Executes hooks for a given lifecycle event.
 * Supports: shell command hooks, HTTP webhooks, function hooks.
 *
 * Hook output JSON schema:
 * {
 *   "continue": boolean,          // false = block operation
 *   "additionalContext": string,  // inject into system prompt
 *   "systemMessage": string,      // show in TUI
 *   "blockReason": string         // reason when continue=false
 * }
 */

import { spawn } from "child_process"
import { Log } from "../util/log"
import type {
  HookEvent,
  HookInput,
  HookOutput,
  Hook,
  CommandHook,
  HttpHook,
  FunctionHook,
} from "./types"

const log = Log.create({ service: "hook-runner" })

const DEFAULT_HOOK_TIMEOUT_MS = 30_000

// ─── Shell Command Hook ───────────────────────────────────────────────────────

async function runCommandHook(hook: CommandHook, input: HookInput): Promise<HookOutput | null> {
  const timeout = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS
  const jsonInput = JSON.stringify(input)

  return new Promise<HookOutput | null>((resolve) => {
    let stdout = ""
    let stderr = ""

    const proc = spawn("bash", ["-c", hook.command], {
      cwd: input.cwd,
      env: {
        ...process.env,
        NAVI_HOOK_EVENT: input.event,
        NAVI_SESSION_ID: input.sessionID,
        NAVI_TOOL: input.tool ?? "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    proc.stdin?.write(jsonInput)
    proc.stdin?.end()

    proc.stdout?.setEncoding("utf8")
    proc.stderr?.setEncoding("utf8")
    proc.stdout?.on("data", (chunk: string) => { stdout += chunk })
    proc.stderr?.on("data", (chunk: string) => { stderr += chunk })

    const timer = setTimeout(() => {
      proc.kill()
      log.warn("hook timed out", { command: hook.command, timeout })
      resolve(null)
    }, timeout)

    proc.once("close", (code) => {
      clearTimeout(timer)
      log.info("command hook completed", { command: hook.command, code, stderr: stderr.slice(0, 200) })

      const trimmed = stdout.trim()
      if (!trimmed) {
        resolve(null)
        return
      }

      try {
        const parsed = JSON.parse(trimmed) as HookOutput
        resolve(parsed)
      } catch {
        // Non-JSON output is treated as informational only
        log.info("hook output (non-JSON)", { output: trimmed.slice(0, 500) })
        resolve(null)
      }
    })

    proc.once("error", (err) => {
      clearTimeout(timer)
      log.error("command hook error", { command: hook.command, err })
      resolve(null)
    })
  })
}

// ─── HTTP Webhook Hook ────────────────────────────────────────────────────────

async function runHttpHook(hook: HttpHook, input: HookInput): Promise<HookOutput | null> {
  const timeout = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(hook.url, {
      method: hook.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...hook.headers,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!response.ok) {
      log.warn("http hook returned non-2xx", { url: hook.url, status: response.status })
      return null
    }

    const text = await response.text()
    if (!text.trim()) return null

    const parsed = JSON.parse(text) as HookOutput
    return parsed
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === "AbortError") {
      log.warn("http hook timed out", { url: hook.url, timeout })
    } else {
      log.error("http hook error", { url: hook.url, err })
    }
    return null
  }
}

// ─── Function Hook ────────────────────────────────────────────────────────────

async function runFunctionHook(hook: FunctionHook, input: HookInput): Promise<HookOutput | null> {
  try {
    const result = await hook.fn(input)
    return result ?? null
  } catch (err) {
    log.error("function hook error", { id: hook.id, err })
    return null
  }
}

// ─── Aggregated Result ────────────────────────────────────────────────────────

export type AggregatedHookResult = {
  /** Whether to continue the operation */
  shouldContinue: boolean
  /** Block reason (if blocked) */
  blockReason?: string
  /** Additional contexts from all hooks, merged */
  additionalContexts: string[]
  /** System messages from all hooks */
  systemMessages: string[]
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

/**
 * Execute a single hook and return its output.
 */
export async function runHook(hook: Hook, input: HookInput): Promise<HookOutput | null> {
  log.info("running hook", { type: hook.type, event: input.event })

  if (hook.type === "command") {
    // Apply tool filter if present
    if (hook.toolFilter && hook.toolFilter !== "*" && hook.toolFilter !== input.tool) {
      return null
    }
    return runCommandHook(hook, input)
  }

  if (hook.type === "http") {
    if (hook.toolFilter && hook.toolFilter !== "*" && hook.toolFilter !== input.tool) {
      return null
    }
    return runHttpHook(hook, input)
  }

  if (hook.type === "function") {
    return runFunctionHook(hook, input)
  }

  return null
}

/**
 * Execute all hooks for a given event and aggregate results.
 * Hooks run in parallel; if ANY hook blocks, the operation is blocked.
 */
export async function runHooks(hooks: Hook[], input: HookInput): Promise<AggregatedHookResult> {
  const results = await Promise.allSettled(hooks.map((hook) => runHook(hook, input)))

  const aggregated: AggregatedHookResult = {
    shouldContinue: true,
    additionalContexts: [],
    systemMessages: [],
  }

  for (const result of results) {
    if (result.status === "rejected") {
      log.error("hook execution rejected", { reason: result.reason })
      continue
    }

    const output = result.value
    if (!output) continue

    if (output.continue === false) {
      aggregated.shouldContinue = false
      if (output.blockReason) aggregated.blockReason = output.blockReason
    }

    if (output.additionalContext) {
      aggregated.additionalContexts.push(output.additionalContext)
    }

    if (output.systemMessage) {
      aggregated.systemMessages.push(output.systemMessage)
    }
  }

  return aggregated
}
