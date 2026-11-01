import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "@/bus"
import { Session } from "@/session/session"
import type { MessageV2 } from "@/session/message-v2"
import { MessageID, SessionID } from "@/session/schema"
import { SessionSummary } from "@/session/summary"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"

const sessionID = SessionID.make("ses_summary_test")
const messageID = MessageID.make("msg_summary_test")

const messages = () =>
  [
    {
      info: { id: messageID, sessionID, role: "user", time: { created: 0 } },
      parts: [{ type: "step-start", snapshot: "tree-a" }],
    },
    {
      info: { id: MessageID.make("msg_summary_reply"), sessionID, role: "assistant", parentID: messageID },
      parts: [{ type: "step-finish", snapshot: "tree-b" }],
    },
  ] as unknown as MessageV2.WithParts[]

function layer() {
  const calls = { messages: 0, setSummary: 0, active: 0, maxActive: 0 }
  const session = Layer.mock(Session.Service, {
    messages: () =>
      Effect.promise(async () => {
        calls.messages += 1
        calls.active += 1
        calls.maxActive = Math.max(calls.maxActive, calls.active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        calls.active -= 1
        return messages()
      }),
    setSummary: () =>
      Effect.sync(() => {
        calls.setSummary += 1
      }),
    updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.succeed(msg),
  })
  const snapshot = Layer.mock(Snapshot.Service, {
    diffFull: () => Effect.succeed([]),
  })
  const storage = Layer.mock(Storage.Service, {
    write: <T>(_: string[], __: T) => Effect.void,
    read: <T>(_: string[]) => Effect.succeed({} as T),
  })
  const bus = Layer.mock(Bus.Service, {
    publish: () => Effect.void,
  })
  return {
    calls,
    layer: SessionSummary.layer.pipe(Layer.provide(Layer.mergeAll(session, snapshot, storage, bus))),
  }
}

describe("SessionSummary.summarize", () => {
  test("skips the history pass when the tree did not move", async () => {
    const ctx = layer()
    await Effect.runPromise(
      Effect.gen(function* () {
        const summary = yield* SessionSummary.Service
        yield* summary.summarize({ sessionID, messageID, snapshot: "tree-b" })
        yield* summary.summarize({ sessionID, messageID, snapshot: "tree-b" })
      }).pipe(Effect.provide(ctx.layer)),
    )

    expect(ctx.calls.messages).toBe(1)
    expect(ctx.calls.setSummary).toBe(1)
  })

  test("recomputes when the tree moved", async () => {
    const ctx = layer()
    await Effect.runPromise(
      Effect.gen(function* () {
        const summary = yield* SessionSummary.Service
        yield* summary.summarize({ sessionID, messageID, snapshot: "tree-b" })
        yield* summary.summarize({ sessionID, messageID, snapshot: "tree-c" })
      }).pipe(Effect.provide(ctx.layer)),
    )

    expect(ctx.calls.messages).toBe(2)
    expect(ctx.calls.setSummary).toBe(2)
  })

  test("serves concurrent steps one at a time", async () => {
    const ctx = layer()
    await Effect.runPromise(
      Effect.gen(function* () {
        const summary = yield* SessionSummary.Service
        yield* Effect.all(
          [
            summary.summarize({ sessionID, messageID, snapshot: "tree-b" }),
            summary.summarize({ sessionID, messageID, snapshot: "tree-c" }),
            summary.summarize({ sessionID, messageID, snapshot: "tree-d" }),
          ],
          { concurrency: "unbounded" },
        )
      }).pipe(Effect.provide(ctx.layer)),
    )

    expect(ctx.calls.maxActive).toBe(1)
    // The in-flight run re-reads once for the newest latched request.
    expect(ctx.calls.messages).toBe(2)
    expect(ctx.calls.setSummary).toBe(2)
  })
})
