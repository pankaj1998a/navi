import { Effect, Layer, Context, Schema } from "effect"
import { Bus } from "@/bus"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { zod } from "@navi-ai/core/effect-zod"
import { withStatics } from "@navi-ai/core/schema"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID } from "./schema"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface SummarizeInput {
  sessionID: SessionID
  messageID: MessageID
  /**
   * Tree hash the finished step captured. When it matches the tree of the last
   * published summary, nothing the summarizer looks at has moved and the stored
   * counts/diffs are still accurate.
   */
  snapshot?: string
}

export interface Interface {
  readonly summarize: (input: SummarizeInput) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: MessageV2.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@navi/SessionSummary") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: MessageV2.WithParts[] }) {
      let from: string | undefined
      let to: string | undefined
      for (const item of input.messages) {
        if (!from) {
          for (const part of item.parts) {
            if (part.type === "step-start" && part.snapshot) {
              from = part.snapshot
              break
            }
          }
        }
        for (const part of item.parts) {
          if (part.type === "step-finish" && part.snapshot) to = part.snapshot
        }
      }
      if (from && to) {
        // Identical tree hashes cannot differ; skip the git diff entirely.
        if (from === to) return []
        return yield* snapshot.diffFull(from, to)
      }
      return []
    })

    // Per-session summarizer state: `running` keeps history loads from stacking
    // up when several steps finish in quick succession, `again` coalesces those
    // requests into the run that is already in flight, and `tree` lets a step
    // that changed nothing reuse the published summary.
    const runs = new Map<SessionID, { running: boolean; again: boolean; input: SummarizeInput; tree?: string }>()
    const maxRuns = 100

    const publish = Effect.fnUntraced(function* (input: SummarizeInput) {
      const all = yield* sessions.messages({ sessionID: input.sessionID })
      if (!all.length) return

      const diffs = yield* computeDiff({ messages: all })
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })

      const messages = all.filter(
        (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
      )
      const target = messages.find((m) => m.info.id === input.messageID)
      if (!target || target.info.role !== "user") return
      const msgDiffs = yield* computeDiff({ messages })
      target.info.summary = { ...target.info.summary, diffs: msgDiffs }
      yield* sessions.updateMessage(target.info)
    })

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: SummarizeInput) {
      const entry = runs.get(input.sessionID) ?? { running: false, again: false, input }
      if (!runs.has(input.sessionID)) {
        runs.set(input.sessionID, entry)
        if (runs.size > maxRuns) {
          for (const [key, value] of runs) {
            if (key === input.sessionID || value.running) continue
            runs.delete(key)
            break
          }
        }
      }

      // Never start a second full-history pass for a session: latch this request
      // onto the run in flight so the last one observes the newest state.
      if (entry.running) {
        entry.again = true
        entry.input = input
        return
      }
      if (input.snapshot !== undefined && entry.tree === input.snapshot) return

      entry.running = true
      entry.input = input
      yield* Effect.gen(function* () {
        while (true) {
          entry.again = false
          const current = entry.input
          yield* publish(current)
          entry.tree = current.snapshot
          if (!entry.again) return
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.running = false
          }),
        ),
      )
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      const diffs = yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", input.sessionID])
        .pipe(Effect.catch(() => Effect.succeed([] as Snapshot.FileDiff[])))
      const next = diffs.map((item) => {
        if (item.file === undefined) return item
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
      const changed = next.some((item, i) => item.file !== diffs[i]?.file)
      if (changed) yield* storage.write(["session_diff", input.sessionID], next).pipe(Effect.ignore)
      return next
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export * as SessionSummary from "./summary"
