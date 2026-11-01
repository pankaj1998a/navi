/**
 * Effect wrappers around the hook registry.
 *
 * Hook implementations are promises (shell commands, HTTP calls, plugin
 * callbacks) and must never fail the caller: a hook that throws or rejects is
 * logged and treated as a no-op. The only way a hook influences control flow is
 * by explicitly returning `continue: false` (or `blockReason`), which callers
 * must enforce themselves (for example by refusing to run a tool).
 *
 * Usage:
 *   import { HookEffect } from "@/hook/effect"
 *
 *   const pre = yield* HookEffect.preToolUse(sessionID, cwd, "bash", args)
 *   if (!pre.shouldContinue) return yield* Effect.fail(new Error(HookEffect.blockMessage("bash", pre.blockReason)))
 */

import { Cause, Effect } from "effect"
import { Log } from "@navi-ai/core/util/log"
import type { HookEvent } from "./types"
import * as Registry from "./registry"

const log = Log.create({ service: "hook.effect" })

function safe<A>(event: HookEvent | "load", fn: () => Promise<A>, fallback: A): Effect.Effect<A> {
  return Effect.promise(fn).pipe(
    Effect.catchCause((cause) => {
      log.warn("hook event failed", { event, err: Cause.squash(cause) })
      return Effect.succeed(fallback)
    }),
  )
}

/** Load `.navi/hooks.json` files once per process. */
export function loadHooks(directory?: string): Effect.Effect<void> {
  return safe("load", () => Registry.loadHooksOnce(directory), undefined).pipe(Effect.asVoid)
}

/** Fire SessionStart hooks. Non-fatal. */
export function sessionStart(sessionID: string, cwd: string, agent?: string): Effect.Effect<void> {
  return safe("SessionStart", () => Registry.onSessionStart(sessionID, cwd, agent), null).pipe(Effect.asVoid)
}

/** Fire SessionEnd hooks. Non-fatal. */
export function sessionEnd(sessionID: string, cwd: string): Effect.Effect<void> {
  return safe("SessionEnd", () => Registry.onSessionEnd(sessionID, cwd), null).pipe(Effect.asVoid)
}

export type PreToolUseResult = {
  shouldContinue: boolean
  blockReason?: string
  additionalContext?: string
}

/** Fire PreToolUse hooks. `shouldContinue: false` means the tool must not run. */
export function preToolUse(
  sessionID: string,
  cwd: string,
  tool: string,
  toolInput: Record<string, unknown>,
  agent?: string,
): Effect.Effect<PreToolUseResult> {
  return safe("PreToolUse", () => Registry.onPreToolUse(sessionID, cwd, tool, toolInput, agent), {
    shouldContinue: true,
  })
}

/** Fire PostToolUse hooks. Non-fatal; cannot undo a completed tool call. */
export function postToolUse(
  sessionID: string,
  cwd: string,
  tool: string,
  toolInput: Record<string, unknown>,
  toolOutput: string,
  agent?: string,
): Effect.Effect<void> {
  return safe(
    "PostToolUse",
    () => Registry.onPostToolUse(sessionID, cwd, tool, toolInput, toolOutput, agent),
    null,
  ).pipe(Effect.asVoid)
}

/** Fire PostToolUseFailure hooks. Non-fatal; the tool error is not swallowed. */
export function postToolUseFailure(
  sessionID: string,
  cwd: string,
  tool: string,
  toolInput: Record<string, unknown>,
  error: string,
  agent?: string,
): Effect.Effect<void> {
  return safe(
    "PostToolUseFailure",
    () => Registry.onPostToolUseFailure(sessionID, cwd, tool, toolInput, error, agent),
    null,
  ).pipe(Effect.asVoid)
}

export type UserPromptSubmitResult = {
  shouldContinue: boolean
  additionalContext?: string
  blockReason?: string
}

/** Fire UserPromptSubmit hooks. `shouldContinue: false` means the prompt is rejected. */
export function userPromptSubmit(
  sessionID: string,
  cwd: string,
  prompt: string,
  agent?: string,
): Effect.Effect<UserPromptSubmitResult> {
  return safe("UserPromptSubmit", () => Registry.onUserPromptSubmit(sessionID, cwd, prompt, agent), {
    shouldContinue: true,
  })
}

/** Fire SubagentStart hooks. Non-fatal. */
export function subagentStart(sessionID: string, cwd: string, agent: string): Effect.Effect<void> {
  return safe("SubagentStart", () => Registry.onSubagentStart(sessionID, cwd, agent), null).pipe(Effect.asVoid)
}

/** Fire SubagentStop hooks. Non-fatal. */
export function subagentStop(sessionID: string, cwd: string, agent: string): Effect.Effect<void> {
  return safe("SubagentStop", () => Registry.onSubagentStop(sessionID, cwd, agent), null).pipe(Effect.asVoid)
}

/** Error message the model sees when a PreToolUse hook blocks a tool call. */
export function blockMessage(tool: string, blockReason?: string): string {
  return blockReason
    ? `Tool "${tool}" was blocked by a PreToolUse hook: ${blockReason}`
    : `Tool "${tool}" was blocked by a PreToolUse hook.`
}

export * as HookEffect from "./effect"
