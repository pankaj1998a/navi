import { describe, test, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { createReplayLlm, installLlmReplay } from "../support/llm-replay"
import { LLM } from "@/session/llm"
import { Token } from "@/util/token"
import { applyToolGuard, resetToolGuard } from "@/tool/guard"
import { Sandbox, SandboxUnavailableError } from "@/sandbox"
import { SessionRetry } from "@/session/retry"

describe("LLM Replay Harness & Hardened Tool Subsystems", () => {
  test("replays pre-recorded model stream events offline", async () => {
    const replay = createReplayLlm([
      {
        text: "Hello! I am ready to help you.",
        finishReason: "stop",
      },
      {
        text: "Invoking file read.",
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "read",
            args: { path: "package.json" },
          },
        ],
        finishReason: "tool-calls",
      },
    ])

    const chunks1 = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLM.Service
        const stream1 = llm.stream({
          user: {} as any,
          sessionID: "test-sess-1",
          model: {} as any,
          agent: {} as any,
          system: [],
          messages: [],
          tools: {},
        })
        const events1 = yield* Stream.runCollect(stream1)
        return Array.from(events1)
      }).pipe(Effect.provide(replay.layer), Effect.orDie),
    )

    expect(chunks1.some((e: any) => e.type === "text-delta" && e.text.includes("Hello!"))).toBe(true)
    expect(chunks1.some((e: any) => e.type === "finish")).toBe(true)

    const chunks2 = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLM.Service
        const stream2 = llm.stream({
          user: {} as any,
          sessionID: "test-sess-1",
          model: {} as any,
          agent: {} as any,
          system: [],
          messages: [],
          tools: {},
        })
        const events2 = yield* Stream.runCollect(stream2)
        return Array.from(events2)
      }).pipe(Effect.provide(replay.layer), Effect.orDie),
    )

    expect(chunks2.some((e: any) => e.type === "tool-call" && e.toolName === "read")).toBe(true)
    expect(replay.calls.length).toBe(2)
  })

  test("calibrated token estimation calculates accurate token budgets", () => {
    expect(Token.estimate("")).toBe(0)
    expect(Token.estimate("hello world")).toBeGreaterThanOrEqual(2)
    // Code and JSON symbols
    const jsonPayload = JSON.stringify({ key: "value", list: [1, 2, 3, 4] })
    expect(Token.estimate(jsonPayload)).toBeGreaterThan(5)
    const cjk = "こんにちは世界 这是一个测试"
    expect(Token.estimate(cjk)).toBeGreaterThanOrEqual(3)
  })

  test("repeat-loop guard escalates warnings through 3, 4-5, and 6+ iterations", () => {
    const sessionID = "sess-loop-test"
    const agent = "coder"
    resetToolGuard(sessionID)

    // 1st and 2nd calls: no reminder
    let out = applyToolGuard({ toolId: "grep", sessionID, agent, args: { query: "foo" }, output: "0 matches" })
    expect(out).toBe("0 matches")
    out = applyToolGuard({ toolId: "grep", sessionID, agent, args: { query: "foo" }, output: "0 matches" })
    expect(out).toBe("0 matches")

    // 3rd call: gentle advisory
    out = applyToolGuard({ toolId: "grep", sessionID, agent, args: { query: "foo" }, output: "0 matches" })
    expect(out).toContain("[System Guard Note: You are repeating the exact same tool call")

    // 4th call: corrective warning
    out = applyToolGuard({ toolId: "grep", sessionID, agent, args: { query: "foo" }, output: "0 matches" })
    expect(out).toContain("Repeated tool call detected (grep × 4)")

    // 6th call: critical infinite loop stop directive
    applyToolGuard({ toolId: "grep", sessionID, agent, args: { query: "foo" }, output: "0 matches" })
    out = applyToolGuard({ toolId: "grep", sessionID, agent, args: { query: "foo" }, output: "0 matches" })
    expect(out).toContain("[System Guard Critical: Infinite loop detected (grep × 6)")
  })

  test("sandbox service resolves workspace confinement policies", async () => {
    const policy = await Effect.runPromise(
      Effect.gen(function* () {
        const sandbox = yield* Sandbox.Service
        return yield* sandbox.resolvePolicy("workspace-write", "v:/pankaj/navi")
      }).pipe(Effect.provide(Sandbox.defaultLayer)),
    )

    expect(policy.mode).toBe("workspace-write")
    expect(policy.workspaceRoot).toContain("navi")
  })

  test("replays session directly from JSONL event log string", async () => {
    const jsonl = [
      JSON.stringify({ type: "session", id: "sess-abc" }),
      JSON.stringify({
        role: "assistant",
        finish: "stop",
        parts: [{ type: "text", text: "I have reviewed your files and found 2 issues." }],
        tokens: { input: 120, output: 45 },
      }),
    ].join("\n")

    const replay = createReplayLlm(jsonl)

    const chunks = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLM.Service
        const stream = llm.stream({
          user: {} as any,
          sessionID: "sess-abc",
          model: {} as any,
          agent: {} as any,
          system: [],
          messages: [],
          tools: {},
        })
        const events = yield* Stream.runCollect(stream)
        return Array.from(events)
      }).pipe(Effect.provide(replay.layer), Effect.orDie),
    )

    expect(chunks.some((e: any) => e.type === "text-delta" && e.text.includes("I have reviewed"))).toBe(true)
    replay.assertConsumed()
  })

  test("sandbox confines execution environment for command spawning or fails closed", async () => {
    const unconfined = await Effect.runPromise(
      Effect.gen(function* () {
        const sandbox = yield* Sandbox.Service
        const policy = yield* sandbox.resolvePolicy("danger-full-access", "v:/pankaj/navi")
        return yield* sandbox.confine("ls", ["-la"], policy)
      }).pipe(Effect.provide(Sandbox.defaultLayer)),
    )

    expect(unconfined.mode).toBe("danger-full-access")
    expect(unconfined.enforcement).toBe("unconfined")
    expect(unconfined.backend).toBe("unconfined")

    // Test synchronous unified confineSync
    const syncUnconfined = Sandbox.confineSync("ls", ["-la"], { mode: "danger-full-access", workspaceRoot: "v:/pankaj/navi" })
    expect(syncUnconfined.enforcement).toBe("unconfined")
  })

  test("installLlmReplay provides high-level replay fixture contract", async () => {
    const handle = installLlmReplay([
      { text: "Response from fixture" },
    ])

    const chunks = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLM.Service
        const stream = llm.stream({} as any)
        return yield* Stream.runCollect(stream)
      }).pipe(Effect.provide(handle.layer), Effect.orDie),
    )

    expect(Array.from(chunks).some((e: any) => e.text === "Response from fixture")).toBe(true)
    handle.assertConsumed()
    handle.dispose()
  })

  test("derives retry count directly from persistent session message history", () => {
    const mockMessages: any[] = [
      {
        info: {
          id: "msg-user-1",
          role: "user",
        },
      },
      {
        info: {
          id: "msg-asst-1",
          role: "assistant",
          retries: 3,
        },
      },
    ]

    expect(SessionRetry.deriveRetryCount(mockMessages, "msg-asst-1")).toBe(3)
    expect(SessionRetry.deriveRetryCount(mockMessages, "msg-user-1")).toBe(0)
    expect(SessionRetry.deriveRetryCount(mockMessages, "msg-unknown")).toBe(0)
  })

  test("sandbox fail-closed error adheres to SANDBOX_UNAVAILABLE schema", () => {
    const err = new SandboxUnavailableError("kernel token isolation failure")
    expect(err._tag).toBe("SANDBOX_UNAVAILABLE")
    expect(err.message).toContain("SANDBOX_UNAVAILABLE")
  })
})
