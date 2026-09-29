import { Effect, Fiber, Schedule } from "effect"
import { Instance } from "../project/instance"
import { Log } from "@navi-ai/core/util/log"
import { registerDisposer } from "../effect/instance-registry"

export namespace Scheduler {
  const log = Log.create({ service: "scheduler" })

  export type Task = {
    id: string
    interval: number
    run: () => Promise<void>
    scope?: "instance" | "global"
  }

  type Entry = {
    tasks: Map<string, Task>
    fibers: Map<string, Fiber.Fiber<void>>
  }

  const create = (): Entry => {
    const tasks = new Map<string, Task>()
    const fibers = new Map<string, Fiber.Fiber<void>>()
    return { tasks, fibers }
  }

  const shared = create()
  const instances = new Map<string, Entry>()

  registerDisposer(async (directory) => {
    const entry = instances.get(directory)
    if (entry) {
      for (const fiber of entry.fibers.values()) {
        await Effect.runPromise(Fiber.interrupt(fiber).pipe(Effect.asVoid))
      }
      entry.tasks.clear()
      entry.fibers.clear()
      instances.delete(directory)
    }
  })

  function state() {
    const dir = Instance.directory
    let entry = instances.get(dir)
    if (!entry) {
      entry = create()
      instances.set(dir, entry)
    }
    return entry
  }

  export function register(task: Task) {
    const scope = task.scope ?? "instance"
    const entry = scope === "global" ? shared : state()
    const current = entry.fibers.get(task.id)
    if (current && scope === "global") return
    if (current) void Effect.runPromise(Fiber.interrupt(current).pipe(Effect.asVoid))

    entry.tasks.set(task.id, task)
    // Effect.repeat + Schedule.fixed replaces the raw setInterval loop:
    // jittered fixed schedule, errors logged not propagated, scoped via Fiber (interrupted on dispose).
    const program = Effect.promise(() => run(task)).pipe(
      Effect.catch((error) => Effect.sync(() => log.error("run failed", { id: task.id, error }))),
      Effect.repeat(Schedule.fixed(task.interval).pipe(Schedule.jittered)),
      Effect.asVoid,
    )
    entry.fibers.set(task.id, Effect.runFork(program))
  }

  async function run(task: Task) {
    log.info("run", { id: task.id })
    await task.run().catch((error) => {
      log.error("run failed", { id: task.id, error })
    })
  }
}

