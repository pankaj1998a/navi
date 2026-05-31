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

  type Timer = ReturnType<typeof setInterval>
  type Entry = {
    tasks: Map<string, Task>
    timers: Map<string, Timer>
  }

  const create = (): Entry => {
    const tasks = new Map<string, Task>()
    const timers = new Map<string, Timer>()
    return { tasks, timers }
  }

  const shared = create()
  const instances = new Map<string, Entry>()

  registerDisposer(async (directory) => {
    const entry = instances.get(directory)
    if (entry) {
      for (const timer of entry.timers.values()) {
        clearInterval(timer)
      }
      entry.tasks.clear()
      entry.timers.clear()
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
    const current = entry.timers.get(task.id)
    if (current && scope === "global") return
    if (current) clearInterval(current)

    entry.tasks.set(task.id, task)
    void run(task)
    const timer = setInterval(() => {
      void run(task)
    }, task.interval)
    timer.unref()
    entry.timers.set(task.id, timer)
  }

  async function run(task: Task) {
    log.info("run", { id: task.id })
    await task.run().catch((error) => {
      log.error("run failed", { id: task.id, error })
    })
  }
}

