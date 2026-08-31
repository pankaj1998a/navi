import { InstanceState } from "@/effect/instance-state"
import { Runner } from "@/effect/runner"
import { Effect, Latch, Layer, Scope, Context } from "effect"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { SessionStatus } from "./status"
import { BackgroundJob } from "../background-job"

export interface Interface {
  readonly assertNotBusy: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly cancelChildren: (parentID: SessionID) => Effect.Effect<void>
  readonly ensureRunning: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
  ) => Effect.Effect<MessageV2.WithParts>
  readonly startShell: (
    sessionID: SessionID,
    onInterrupt: Effect.Effect<MessageV2.WithParts>,
    work: Effect.Effect<MessageV2.WithParts>,
    ready?: Latch.Latch,
  ) => Effect.Effect<MessageV2.WithParts>
}

export class Service extends Context.Service<Service, Interface>()("@navi/SessionRunState") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionRunState.state")(function* () {
        const scope = yield* Scope.Scope
        const runners = new Map<SessionID, Runner.Runner<MessageV2.WithParts>>()
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.forEach(runners.values(), (runner) => runner.cancel, {
              concurrency: "unbounded",
              discard: true,
            })
            runners.clear()
          }),
        )
        return { runners, scope }
      }),
    )

    const runner = Effect.fn("SessionRunState.runner")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
    ) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing) return existing
      const next = Runner.make<MessageV2.WithParts>(data.scope, {
        onIdle: Effect.gen(function* () {
          data.runners.delete(sessionID)
          yield* status.set(sessionID, { type: "idle" })
        }),
        onBusy: status.set(sessionID, { type: "busy" }),
        onInterrupt,
        busy: () => {
          throw new Session.BusyError(sessionID)
        },
      })
      data.runners.set(sessionID, next)
      return next
    })

    const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (existing?.busy) throw new Session.BusyError(sessionID)
    })

    const cancelBackgroundJobs = Effect.fn("SessionRunState.cancelBackgroundJobs")(function* (
      sessionID: SessionID,
    ) {
      const jobs = yield* background.list()
      const pending = new Set<string>([sessionID])
      const cancelled = new Set<string>()
      const matches = (job: BackgroundJob.Info) => {
        if (job.status !== "running") return false
        if (cancelled.has(job.id)) return false
        if (pending.has(job.id)) return true
        if (typeof job.metadata?.sessionId === "string" && pending.has(job.metadata.sessionId)) return true
        return typeof job.metadata?.parentSessionId === "string" && pending.has(job.metadata.parentSessionId)
      }
      let batch = jobs.filter(matches)
      while (batch.length > 0) {
        yield* Effect.forEach(
          batch,
          (job) =>
            background.cancel(job.id).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  cancelled.add(job.id)
                  pending.add(job.id)
                  if (typeof job.metadata?.sessionId === "string") pending.add(job.metadata.sessionId)
                }),
              ),
            ),
          { concurrency: "unbounded", discard: true },
        )
        batch = jobs.filter(matches)
      }
    })

    const cancel = Effect.fn("SessionRunState.cancel")(function* (sessionID: SessionID) {
      yield* cancelBackgroundJobs(sessionID)
      const data = yield* InstanceState.get(state)
      const existing = data.runners.get(sessionID)
      if (!existing || !existing.busy) {
        yield* status.set(sessionID, { type: "idle" })
        return
      }
      yield* existing.cancel
    })

    const cancelChildren = Effect.fn("SessionRunState.cancelChildren")(function* (parentID: SessionID) {
      const data = yield* InstanceState.get(state)
      for (const [sessionID, existing] of data.runners.entries()) {
        if (!existing.busy) continue
        const info = yield* sessions.get(sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        if (info?.parentID === parentID) {
          yield* cancel(sessionID)
        }
      }
    })

    const ensureRunning = Effect.fn("SessionRunState.ensureRunning")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).ensureRunning(work)
    })

    const startShell = Effect.fn("SessionRunState.startShell")(function* (
      sessionID: SessionID,
      onInterrupt: Effect.Effect<MessageV2.WithParts>,
      work: Effect.Effect<MessageV2.WithParts>,
      ready?: Latch.Latch,
    ) {
      return yield* (yield* runner(sessionID, onInterrupt)).startShell(work, ready)
    })

    return Service.of({ assertNotBusy, cancel, cancelChildren, ensureRunning, startShell })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      SessionStatus.defaultLayer,
      Session.defaultLayer,
      BackgroundJob.layer,
    ),
  ),
)

export * as SessionRunState from "./run-state"
