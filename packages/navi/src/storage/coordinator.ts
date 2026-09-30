export const DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200
export const MAX_TIMER_DELAY_MS = 2147483647

export class PerSessionCoordinator {
  private chains = new Map<string, Promise<void>>()

  serialize<T>(id: string, op: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const prior = this.chains.get(id) ?? Promise.resolve()
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const next = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    const run = () =>
      op().then(
        (v) => resolve(v),
        (e) => reject(e),
      )
    const chained = prior.then(run, run).finally(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id)
    })
    const tail: Promise<void> = chained.then(
      () => {},
      () => {},
    )
    this.chains.set(id, tail)
    if (signal) {
      const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
    }
    return next
  }

  withId<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.serialize(id, fn)
  }

  hasPending(id: string): boolean {
    return this.chains.has(id)
  }
}

export const globalCoordinator = new PerSessionCoordinator()

export * as Coordinator from "./coordinator"
