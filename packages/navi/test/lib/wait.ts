import { setTimeout as delay } from "node:timers/promises"
import { Effect } from "effect"

// Shared polling helper extracted from
// `test/control-plane/workspace.test.ts` `eventually`/`eventuallyEffect`
// with exponential backoff added. Use instead of
// `while (Date.now() < end)` busy-waits and bare `setTimeout(1000)` sleeps.
//
// `waitFor` retries an assertion-style callback (throw = retry) until it
// succeeds or the timeout expires, then rethrows the last error.
// Backoff: starts at `interval`, multiplies by `factor` each retry, capped
// at `maxInterval`. Defaults preserve the old 10ms fixed-poll behaviour
// when `factor` is 1.
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  options?: { timeout?: number; interval?: number; factor?: number; maxInterval?: number },
): Promise<T> {
  const timeout = options?.timeout ?? 5000
  const factor = options?.factor ?? 1.5
  const maxInterval = options?.maxInterval ?? 200
  let interval = options?.interval ?? 10
  const started = Date.now()
  let last: unknown
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (Date.now() - started >= timeout) break
      await delay(Math.min(interval, timeout - (Date.now() - started)))
      interval = Math.min(interval * factor, maxInterval)
    }
  }
  throw last ?? new Error("Timed out waiting for condition")
}

// Poll until `check` returns a non-undefined value (event-latch style).
// Returns the value; throws on timeout.
export async function waitForValue<T>(
  check: () => T | undefined | Promise<T | undefined>,
  options?: { timeout?: number; interval?: number; factor?: number; maxInterval?: number; message?: string },
): Promise<T> {
  return waitFor(async () => {
    const value = await check()
    if (value === undefined) throw new Error(options?.message ?? "Timed out waiting for value")
    return value
  }, options)
}

export function waitForEffect(
  effect: Effect.Effect<void>,
  timeout = 5000,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const started = Date.now()
    let interval = 10
    let last: unknown
    for (;;) {
      const exit = yield* Effect.exit(effect)
      if (exit._tag === "Success") return
      last = exit.cause
      if (Date.now() - started >= timeout) break
      yield* Effect.sleep(`${Math.min(interval, 200)} millis`)
      interval = Math.min(interval * 1.5, 200)
    }
    throw last ?? new Error("Timed out waiting for condition")
  })
}
