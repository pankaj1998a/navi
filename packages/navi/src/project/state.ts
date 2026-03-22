import { Log } from "@/util/log"

export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const log = Log.create({ service: "state" })
  const recordsByKey = new Map<string, Map<any, Entry>>()

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    return () => {
      const key = root()
      let entries = recordsByKey.get(key)
      if (!entries) {
        entries = new Map<string, Entry>()
        recordsByKey.set(key, entries)
      }
      const exists = entries.get(init)
      if (exists) return exists.state as S
      const state = init()
      entries.set(init, {
        state,
        dispose,
      })
      return state
    }
  }

  /**
   * Refresh a specific state entry by re-initializing it.
   * This is useful for updating state after authentication changes.
   * @param key The root key (usually Instance.directory)
   * @param init The init function that was used to create the state
   */
  export function refresh<S>(key: string, init: () => S): S {
    let entries = recordsByKey.get(key)
    if (!entries) {
      // No entries exist, just create new state
      const state = init()
      entries = new Map<any, Entry>()
      entries.set(init, { state })
      recordsByKey.set(key, entries)
      return state
    }

    // Find and remove the old entry
    const existingEntry = entries.get(init)
    if (existingEntry) {
      // Call dispose if available (synchronously for now)
      if (existingEntry.dispose) {
        Promise.resolve(existingEntry.state)
          .then((s) => existingEntry.dispose!(s))
          .catch((error) => log.error("Error while disposing state during refresh:", { error, key }))
      }
      entries.delete(init)
    }

    // Create new state
    const state = init()
    entries.set(init, { state })
    log.info("refreshed state", { key })
    return state
  }

  export async function dispose(key: string) {
    const entries = recordsByKey.get(key)
    if (!entries) return

    log.info("waiting for state disposal to complete", { key })

    let disposalFinished = false

    setTimeout(() => {
      if (!disposalFinished) {
        log.warn(
          "state disposal is taking an unusually long time - if it does not complete in a reasonable time, please report this as a bug",
          { key },
        )
      }
    }, 10000).unref()

    const tasks: Promise<void>[] = []
    for (const entry of entries.values()) {
      if (!entry.dispose) continue

      const task = Promise.resolve(entry.state)
        .then((state) => entry.dispose!(state))
        .catch((error) => {
          log.error("Error while disposing state:", { error, key })
        })

      tasks.push(task)
    }
    entries.clear()
    await Promise.all(tasks)
    disposalFinished = true
    log.info("state disposal completed", { key })
  }
}
