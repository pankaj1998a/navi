import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import fs from "fs/promises"
import * as Hook from "./registry"
import { HookEffect } from "./effect"
import type { HookEvent } from "./types"

const registered: { event: HookEvent; id: string }[] = []

function register(event: HookEvent, hook: Parameters<typeof Hook.registerFunctionHook>[1]) {
  Hook.registerFunctionHook(event, hook)
  registered.push({ event, id: hook.id })
}

afterEach(() => {
  for (const item of registered.splice(0)) Hook.unregisterFunctionHook(item.event, item.id)
})

describe("hook effect wiring", () => {
  test("preToolUse continues when no hooks are registered", async () => {
    const result = await Effect.runPromise(HookEffect.preToolUse("session", os.tmpdir(), "bash", { command: "ls" }))
    expect(result.shouldContinue).toBe(true)
    expect(result.blockReason).toBeUndefined()
  })

  test("a blocking function hook propagates shouldContinue=false and the block reason", async () => {
    register("PreToolUse", {
      type: "function",
      id: "block-recursive-delete",
      fn: async (input) => {
        if (String(input.toolInput?.command).includes("rm -rf")) {
          return { continue: false, blockReason: "recursive delete is not allowed" }
        }
      },
    })

    const direct = await Hook.onPreToolUse("session", os.tmpdir(), "bash", { command: "rm -rf /tmp/x" })
    expect(direct.shouldContinue).toBe(false)
    expect(direct.blockReason).toBe("recursive delete is not allowed")

    const wired = await Effect.runPromise(
      HookEffect.preToolUse("session", os.tmpdir(), "bash", { command: "rm -rf /tmp/x" }),
    )
    expect(wired.shouldContinue).toBe(false)
    expect(wired.blockReason).toBe("recursive delete is not allowed")
    expect(HookEffect.blockMessage("bash", wired.blockReason)).toBe(
      'Tool "bash" was blocked by a PreToolUse hook: recursive delete is not allowed',
    )

    const allowed = await Effect.runPromise(
      HookEffect.preToolUse("session", os.tmpdir(), "bash", { command: "ls /tmp" }),
    )
    expect(allowed.shouldContinue).toBe(true)
  })

  test("a blockReason without continue=false still blocks", async () => {
    register("PreToolUse", {
      type: "function",
      id: "reason-only",
      fn: async (input) => {
        if (input.tool === "bash") return { blockReason: "bash is disabled" }
      },
    })
    const result = await Effect.runPromise(HookEffect.preToolUse("session", os.tmpdir(), "bash", { command: "ls" }))
    expect(result.shouldContinue).toBe(false)
    expect(result.blockReason).toBe("bash is disabled")
  })

  test("a throwing hook is non-fatal", async () => {
    register("PreToolUse", {
      type: "function",
      id: "throwing-hook",
      fn: async () => {
        throw new Error("hook exploded")
      },
    })
    const result = await Effect.runPromise(HookEffect.preToolUse("session", os.tmpdir(), "bash", { command: "ls" }))
    expect(result.shouldContinue).toBe(true)
  })

  test("post hooks receive the tool output and failure error", async () => {
    const seen: string[] = []
    register("PostToolUse", {
      type: "function",
      id: "record-output",
      fn: async (input) => {
        seen.push(`ok:${input.tool}:${input.toolOutput}`)
      },
    })
    register("PostToolUseFailure", {
      type: "function",
      id: "record-failure",
      fn: async (input) => {
        seen.push(`fail:${input.tool}:${input.error}`)
      },
    })

    await Effect.runPromise(HookEffect.postToolUse("session", os.tmpdir(), "bash", { command: "ls" }, "file.txt"))
    await Effect.runPromise(HookEffect.postToolUseFailure("session", os.tmpdir(), "bash", { command: "ls" }, "boom"))

    expect(seen).toEqual(["ok:bash:file.txt", "fail:bash:boom"])
  })

  test("userPromptSubmit continues when no hooks are registered", async () => {
    const result = await Effect.runPromise(HookEffect.userPromptSubmit("session", os.tmpdir(), "hello"))
    expect(result.shouldContinue).toBe(true)
    expect(result.blockReason).toBeUndefined()
  })

  test("a blocking UserPromptSubmit hook surfaces its reason", async () => {
    register("UserPromptSubmit", {
      type: "function",
      id: "reject-secrets",
      fn: async () => ({ continue: false, blockReason: "prompt contains a secret" }),
    })
    const result = await Effect.runPromise(HookEffect.userPromptSubmit("session", os.tmpdir(), "sk-..."))
    expect(result.shouldContinue).toBe(false)
    expect(result.blockReason).toBe("prompt contains a secret")
  })

  test("loading hooks from a directory without a hooks file is a no-op", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-test-"))
    try {
      await expect(Hook.loadHooks(dir)).resolves.toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("loadHooksOnce caches, and lookups observe file changes after the throttle window", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-once-"))
    const hooksDir = path.join(dir, ".navi")
    await fs.mkdir(hooksDir)
    const hooksFile = path.join(hooksDir, "hooks.json")
    // ConfigChange is never fired by the runtime, so this stays side-effect free.
    await Bun.write(hooksFile, JSON.stringify({ ConfigChange: [{ type: "command", command: "true" }] }))
    // Project hooks require an explicit trust opt-in.
    process.env.NAVI_HOOKS_TRUSTED = "1"
    try {
      await Hook.loadHooksOnce(dir)
      expect(await Hook.hasHooks("ConfigChange", dir)).toBe(true)
      // Removing the file invalidates the cached state on the next lookup once
      // the 1s stat throttle has elapsed.
      await fs.rm(hooksFile)
      await Bun.sleep(1_100)
      expect(await Hook.hasHooks("ConfigChange", dir)).toBe(false)
      // loadHooksOnce keeps its per-process promise; it must not revive hooks.
      await Hook.loadHooksOnce(dir)
      expect(await Hook.hasHooks("ConfigChange", dir)).toBe(false)
    } finally {
      delete process.env.NAVI_HOOKS_TRUSTED
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
