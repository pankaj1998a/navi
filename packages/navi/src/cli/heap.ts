import path from "path"
import { writeHeapSnapshot } from "node:v8"
import { Effect, Fiber, Schedule } from "effect"
import { Flag } from "@navi-ai/core/flag/flag"
import { Global } from "@navi-ai/core/global"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "heap" })
const MINUTE = 60_000
const LIMIT = 2 * 1024 * 1024 * 1024
// Bound disk usage: keep at most N snapshots per process.
const MAX_SNAPSHOTS = 3

let fiber: Fiber.Fiber<void> | undefined
let lock = false
let armed = true
let snapshots = 0

export function start() {
  if (!Flag.NAVI_AUTO_HEAP_SNAPSHOT) return
  if (fiber) return

  const run = async () => {
    if (lock) return

    const stat = process.memoryUsage()
    if (stat.rss <= LIMIT) {
      armed = true
      return
    }
    if (!armed) return
    if (snapshots >= MAX_SNAPSHOTS) return

    lock = true
    armed = false
    snapshots += 1
    const file = path.join(
      Global.Path.log,
      `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    log.warn("heap usage exceeded limit", {
      rss: stat.rss,
      heap: stat.heapUsed,
      file,
    })

    await Promise.resolve()
      .then(() => writeHeapSnapshot(file))
      .catch((err) => {
        log.error("failed to write heap snapshot", {
          error: err instanceof Error ? err.message : String(err),
          file,
        })
      })

    lock = false
  }

  // Effect.repeat + jittered Schedule replaces the raw setInterval loop.
  fiber = Effect.runFork(
    Effect.promise(() => run()).pipe(
      Effect.catch((error) => Effect.sync(() => log.error("heap check failed", { error }))),
      Effect.repeat(Schedule.fixed(MINUTE).pipe(Schedule.jittered)),
      Effect.asVoid,
    ),
  )
}

export * as Heap from "./heap"
