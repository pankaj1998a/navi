// Deterministic test-name helper. Replaces `Math.random()` / `Date.now()`
// branch/dir suffixes that collide under parallel runs and break
// reproducibility. Counter is per-process and monotonic, so names are unique
// within a run and stable across reruns with the same test order.
let seq = 0

export function uniqueName(prefix: string): string {
  seq += 1
  return `${prefix}-${process.pid.toString(36)}-${seq.toString(36).padStart(4, "0")}`
}

export function resetUniqueNames() {
  seq = 0
}

// Deterministic small delay replacing `Bun.sleep(Math.random() * N)` in
// contention tests. Cycles 0..maxMs so concurrent fibers still interleave
// without randomness.
export function deterministicDelayMs(step: number, maxMs = 2): number {
  return step % (maxMs + 1)
}
