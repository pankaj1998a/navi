import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "instance.dispose" })

interface DisposerEntry {
  readonly disposer: (directory: string) => Promise<void>
  /** Captured at registration to identify the owning service in timeout warnings. */
  readonly stack: string | undefined
}

const disposers = new Set<DisposerEntry>()

const DEFAULT_DISPOSE_TIMEOUT_MS = 5_000
const DEFAULT_SHUTDOWN_EXIT_GRACE_MS = 3_000
const MIN_SHUTDOWN_EXIT_GRACE_MS = 500
const MAX_SHUTDOWN_EXIT_GRACE_MS = 30_000
/** Upper bound for a single stdio drain; a dead pipe must never block exit. */
const FLUSH_TIMEOUT_MS = 1_000

/**
 * Timeout applied per instance disposer (and to the store's wait for an
 * in-flight load/reload). Disposal must never block process exit, so a
 * wedged finalizer is abandoned after this bound and a warning is logged.
 *
 * Override with `NAVI_DISPOSE_TIMEOUT_MS`; invalid values fall back to 5s.
 */
export function disposeTimeoutMs(): number {
  const raw = process.env.NAVI_DISPOSE_TIMEOUT_MS
  if (!raw) return DEFAULT_DISPOSE_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DISPOSE_TIMEOUT_MS
}

/**
 * Grace period used by the one-shot CLI forced-shutdown watchdog.
 *
 * Override with `NAVI_SHUTDOWN_TIMEOUT_MS`; values are clamped to
 * `[500, 30000]` so a typo cannot disable the watchdog or fire it instantly.
 * Non-numeric values fall back to the 3s default.
 */
export function shutdownTimeoutMs(): number {
  const raw = process.env.NAVI_SHUTDOWN_TIMEOUT_MS
  if (!raw) return DEFAULT_SHUTDOWN_EXIT_GRACE_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_SHUTDOWN_EXIT_GRACE_MS
  return Math.min(MAX_SHUTDOWN_EXIT_GRACE_MS, Math.max(MIN_SHUTDOWN_EXIT_GRACE_MS, Math.trunc(parsed)))
}

/**
 * Resolve once every chunk queued on `stream` before this call has been handed
 * to the OS. `write("", cb)` is ordered behind prior writes, so the callback
 * fires only after the kernel accepted them (including async pipe/file writes).
 */
function drain(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed || !stream.writable) return resolve()
    try {
      stream.write("", () => resolve())
    } catch {
      resolve()
    }
  })
}

/**
 * Drain stdout and stderr, bounded by `timeoutMs`. A disconnected pipe (reader
 * gone) can leave a write callback pending forever, so the drain is raced
 * against an unref'd timer: exit must never be blocked by stdio, but it should
 * not truncate writes that are still being accepted.
 */
export async function flushStdio(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bounded = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
    timer.unref?.()
  })
  try {
    await Promise.race([Promise.all([drain(process.stdout), drain(process.stderr)]).then(() => undefined), bounded])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let shutdownTimer: ReturnType<typeof setTimeout> | undefined

/** True while the one-shot forced-shutdown watchdog is armed. */
export function shutdownExitArmed(): boolean {
  return shutdownTimer !== undefined
}

/**
 * Cancel an armed forced-shutdown watchdog (if any). Exposed for tests and for
 * embedders that armed the watchdog and then decided to stay alive.
 */
export function cancelShutdownExit() {
  if (!shutdownTimer) return
  clearTimeout(shutdownTimer)
  shutdownTimer = undefined
}

/**
 * Arm a forced process exit after a one-shot CLI command has finished.
 *
 * Call this ONLY from the one-shot CLI entry/teardown path (`src/index.ts`)
 * after runtime disposal. It must never be armed by `InstanceStore`, layer
 * finalizers, or `AppRuntime.dispose()` itself: an embedder that disposes the
 * runtime mid-life still intends to keep running.
 *
 * Two known offenders survive runtime scope teardown: native file-watcher
 * subscriptions whose `unsubscribe()` fails on some platforms, and
 * `Effect.forkDetach` background fibers (history backfill) that only finish
 * after tens of seconds of sleeps. The timer is unref'd, so a clean shutdown
 * never pays for it and the process still exits naturally when the event loop
 * drains; it only fires when something is provably still keeping the loop
 * alive after the grace period, and then flushes stdio before forcing the
 * pending exit code.
 *
 * Returns a disarm function. Re-arming while already armed is a no-op.
 * Skipped under `bun test`, where runtimes are disposed between tests while
 * the test process must keep running.
 */
export function scheduleShutdownExit(graceMs = shutdownTimeoutMs()): () => void {
  if (process.env.NODE_ENV === "test") return () => {}
  if (shutdownTimer) return cancelShutdownExit
  const timer = setTimeout(() => {
    // Never truncate buffered output: drain stdio first, then force the exit.
    void flushStdio().then(() => {
      shutdownTimer = undefined
      process.exit(process.exitCode ?? 0)
    })
  }, graceMs)
  timer.unref?.()
  shutdownTimer = timer
  return cancelShutdownExit
}

export function registerDisposer(disposer: (directory: string) => Promise<void>) {
  const entry: DisposerEntry = { disposer, stack: new Error().stack }
  disposers.add(entry)
  return () => {
    disposers.delete(entry)
  }
}

async function runWithTimeout(entry: DisposerEntry, directory: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  const pending = Promise.resolve().then(() => entry.disposer(directory))
  // The disposer may settle (or reject) after we stop waiting on a timeout.
  // Swallow that late settlement so it cannot surface as an unhandled rejection.
  pending.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs)
    // Never keep the event loop alive just to observe a timeout.
    timer.unref?.()
  })

  try {
    const result = await Promise.race([pending.then(() => "done" as const), timedOut])
    if (result === "timeout") {
      log.warn("instance disposer timed out; continuing shutdown", {
        directory,
        timeoutMs,
        elapsed: Date.now() - started,
        stack: entry.stack,
      })
    }
  } catch (error) {
    log.warn("instance disposer failed", { directory, error: String(error) })
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Run every registered disposer for `directory`, bounded by
 * `disposeTimeoutMs()`. Always resolves: a hanging finalizer is abandoned
 * rather than blocking the caller (and therefore process exit) forever.
 */
export async function disposeInstance(directory: string) {
  const timeoutMs = disposeTimeoutMs()
  await Promise.allSettled([...disposers].map((entry) => runWithTimeout(entry, directory, timeoutMs)))
}
