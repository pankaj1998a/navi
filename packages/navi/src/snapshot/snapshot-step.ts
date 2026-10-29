import { Cause, Effect } from "effect"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { Policy } from "@/permission/policy"
import type { InstanceContext } from "@/project/instance"
import { Snapshot } from "@/snapshot"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "snapshot.step" })

/**
 * A single per-step capture of the session working directory.
 *
 * The bytes live in NAVI's existing shadow git repository (see `@/snapshot`).
 * This module only adds per-step addressing and the restore guard on top.
 */
export interface StepSnapshot {
  /** Addressable id — unique per capture. */
  id: string
  /** Tree hash of the capture inside the shadow git repository. */
  hash: string
  /** Directory the capture is scoped to. */
  path: string
  sessionID: string
  step: number
  messageID?: string
}

interface Registry {
  readonly byMessage: Map<string, StepSnapshot>
}

const registry = new Map<string, Registry>()

/**
 * Captures retained per session.
 *
 * Every capture writes a tree into the shadow git repository, so an unbounded
 * registry would fill the disk one assistant turn at a time. An evicted capture
 * releases the git ref that keeps its tree alive, so git can reclaim the bytes.
 */
const maxPerSession = 100

/** Whether a session in the same directory still holds a capture of this tree. */
function retained(hash: string, path: string) {
  for (const entry of registry.values()) {
    for (const snapshot of entry.byMessage.values()) {
      if (snapshot.hash === hash && snapshot.path === path) return true
    }
  }
  return false
}

/**
 * Releases a capture's git ref once no session in the same directory holds it.
 *
 * The ref is what keeps the tree from being pruned, so a capture nobody can
 * address any more must not keep its bytes alive.
 */
const releaseIfUnused = (hash: string, path: string) =>
  Effect.gen(function* () {
    if (retained(hash, path)) return
    const snapshot = yield* Snapshot.Service
    yield* snapshot.release(hash)
  })

const resolveScope = (override?: string) =>
  Effect.gen(function* () {
    if (override) return path.resolve(override)
    const ctx = yield* InstanceState.context.pipe(
      Effect.catchCause((cause) => {
        log.warn("no instance context for step snapshot", { cause: Cause.pretty(cause) })
        return Effect.succeed(undefined as InstanceContext | undefined)
      }),
    )
    return ctx?.directory
  })

/**
 * Capture the session working directory as a per-step snapshot.
 *
 * Never fails: a project without a VCS, disabled snapshots, or a broken git
 * state all resolve to `undefined` so the agent step can proceed.
 */
export const capture = (input: {
  sessionID: string
  step: number
  messageID?: string
  path?: string
}): Effect.Effect<StepSnapshot | undefined, never, Snapshot.Service> =>
  Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const directory = yield* resolveScope(input.path)
    if (!directory) return undefined
    const hash = yield* snapshot.track().pipe(
      Effect.catchCause((cause) => {
        log.warn("failed to capture step snapshot", {
          sessionID: input.sessionID,
          step: input.step,
          cause: Cause.pretty(cause),
        })
        return Effect.succeed(undefined)
      }),
    )
    if (!hash) return undefined
    const record: StepSnapshot = {
      id: `${input.step}-${hash}`,
      hash,
      path: directory,
      sessionID: input.sessionID,
      step: input.step,
      messageID: input.messageID,
    }
    log.info("captured step snapshot", { sessionID: input.sessionID, step: input.step, hash })
    return record
  })

/**
 * Bind a step's capture to the assistant message it belongs to, so a later
 * revert can address that exact turn.
 *
 * The session keeps at most `maxPerSession` captures. Evicting the oldest one
 * releases the git ref that holds its tree, so a long session cannot fill the
 * disk with snapshots nobody can address any more.
 */
export const bind = (input: {
  sessionID: string
  messageID: string
  snapshot?: StepSnapshot
}): Effect.Effect<void, never, Snapshot.Service> =>
  Effect.gen(function* () {
    if (!input.snapshot) return
    const entry = registry.get(input.sessionID) ?? { byMessage: new Map<string, StepSnapshot>() }
    const previous = entry.byMessage.get(input.messageID)
    entry.byMessage.set(input.messageID, { ...input.snapshot, messageID: input.messageID })
    registry.set(input.sessionID, entry)

    if (previous && previous.hash !== input.snapshot.hash) {
      yield* releaseIfUnused(previous.hash, previous.path)
    }

    while (entry.byMessage.size > maxPerSession) {
      const oldest = entry.byMessage.keys().next().value
      if (oldest === undefined) break
      const evicted = entry.byMessage.get(oldest)
      entry.byMessage.delete(oldest)
      if (!evicted) continue
      yield* releaseIfUnused(evicted.hash, evicted.path)
    }
  })

/** Look up the per-step snapshot captured for an assistant message. */
export const lookup = (input: {
  sessionID: string
  messageID: string
}): Effect.Effect<StepSnapshot | undefined> =>
  Effect.sync(() => registry.get(input.sessionID)?.byMessage.get(input.messageID))

/**
 * Restore a snapshot.
 *
 * When `files` is given, only those paths are restored to the snapshot state
 * (a path missing from the snapshot is removed). Every path is checked against
 * the session directory first, so a path that escapes the workspace is
 * rejected instead of written. Resolves to `false` when the snapshot is
 * unknown or a path escapes; it never throws.
 */
export const restore = (input: {
  hash: string
  path?: string
  files?: readonly string[]
}): Effect.Effect<boolean, never, Snapshot.Service> =>
  Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const directory = yield* resolveScope(input.path)
    if (!directory) return false

    if (input.files) {
      const targets: string[] = []
      for (const file of input.files) {
        const resolved = path.isAbsolute(file) ? path.resolve(file) : path.resolve(directory, file)
        if (!Policy.isLexicallyUnder(resolved, directory)) {
          log.warn("rejected snapshot restore outside the session directory", { file, directory })
          return false
        }
        targets.push(resolved)
      }
      if (!targets.length) return true
      if (!(yield* snapshot.exists(input.hash))) return false
      yield* snapshot.revert([{ hash: input.hash, files: targets }])
      return true
    }

    if (!(yield* snapshot.exists(input.hash))) return false
    yield* snapshot.restore(input.hash)
    return true
  })

export * as SnapshotStep from "./snapshot-step"
