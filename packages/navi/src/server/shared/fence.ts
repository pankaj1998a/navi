import { Database } from "@/storage/db"
import { inArray } from "drizzle-orm"
import { EventSequenceTable } from "@/sync/event.sql"
import { Workspace } from "@/control-plane/workspace"
import type { WorkspaceID } from "@/control-plane/schema"
import * as Log from "@navi-ai/core/util/log"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"

export const HEADER = "x-navi-sync"
export type State = Record<string, number>
const log = Log.create({ service: "fence" })

// Chunk large inArray lists to respect SQLite variable limits (~999 vars).
const FENCE_CHUNK = 500

export function load(ids?: string[]) {
  const rows = Database.use((db) => {
    if (!ids?.length) {
      return db.select().from(EventSequenceTable).all()
    }

    const out: (typeof EventSequenceTable.$inferSelect)[] = []
    for (let i = 0; i < ids.length; i += FENCE_CHUNK) {
      const part = ids.slice(i, i + FENCE_CHUNK)
      out.push(
        ...db.select().from(EventSequenceTable).where(inArray(EventSequenceTable.aggregate_id, part)).all(),
      )
    }
    return out
  })

  return Object.fromEntries(rows.map((row) => [row.aggregate_id, row.seq])) as State
}

export function diff(prev: State, next: State) {
  const ids = new Set([...Object.keys(prev), ...Object.keys(next)])
  return Object.fromEntries(
    [...ids]
      .map((id) => [id, next[id] ?? -1] as const)
      .filter(([id, seq]) => {
        return (prev[id] ?? -1) !== seq
      }),
  ) as State
}

export function parse(headers: Headers) {
  const raw = headers.get(HEADER)
  if (!raw) return

  let data

  try {
    data = JSON.parse(raw)
  } catch (err) {
    log.error("Failed to parse x-navi-sync header; rejecting malformed sync fence", { raw, error: String(err) })
    throw new Error(`Malformed '${HEADER}' header: invalid JSON`)
  }

  if (!data || typeof data !== "object") {
    log.error("Invalid x-navi-sync header shape; expected object", { raw })
    throw new Error(`Malformed '${HEADER}' header: expected object mapping ID to sequence`)
  }

  return Object.fromEntries(
    Object.entries(data).filter(([id, seq]) => {
      return typeof id === "string" && Number.isInteger(seq)
    }),
  ) as State
}

export function waitEffect(workspaceID: WorkspaceID, state: State, signal?: AbortSignal) {
  return Effect.gen(function* () {
    log.info("waiting for state", {
      workspaceID,
      state,
    })
    yield* Workspace.Service.use((workspace) => workspace.waitForSync(workspaceID, state, signal))
    log.info("state fully synced", {
      workspaceID,
      state,
    })
  })
}

export async function wait(workspaceID: WorkspaceID, state: State, signal?: AbortSignal) {
  await AppRuntime.runPromise(waitEffect(workspaceID, state, signal))
}
