import { afterEach, describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@navi-ai/core/cross-spawn-spawner"
import { $ } from "bun"
import { Context, Deferred, Duration, Effect, Exit, Fiber, Layer } from "effect"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { InstanceState } from "@/effect/instance-state"
import {
  cancelShutdownExit,
  flushStdio,
  scheduleShutdownExit,
  shutdownExitArmed,
  shutdownTimeoutMs,
} from "@/effect/instance-registry"
import { Instance } from "../../src/project/instance"
import { disposeAllInstances, provideInstance, reloadTestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { deterministicDelayMs } from "../lib/names"

const it = testEffect(CrossSpawnSpawner.defaultLayer)

const withEnv = <A>(name: string, value: string | undefined, fn: () => A): A => {
  const previous = process.env[name]
  try {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
    return fn()
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

const access = <A, E>(state: InstanceState.InstanceState<A, E>, dir: string) =>
  InstanceState.get(state).pipe(provideInstance(dir))

const tmpdirGitScoped = Effect.gen(function* () {
  const dir = yield* tmpdirScoped({ git: true })
  yield* Effect.promise(() => $`git commit --allow-empty --amend -m ${`root commit ${dir}`}`.cwd(dir).quiet())
  return dir
})

afterEach(async () => {
  await disposeAllInstances()
})

it.live("InstanceState caches values per directory", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    let n = 0
    const state = yield* InstanceState.make(() => Effect.sync(() => ({ n: ++n })))

    const a = yield* access(state, dir)
    const b = yield* access(state, dir)

    expect(a).toBe(b)
    expect(n).toBe(1)
  }),
)

it.live("InstanceState isolates directories", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirScoped()
    const two = yield* tmpdirScoped()
    let n = 0
    const state = yield* InstanceState.make((dir) => Effect.sync(() => ({ dir, n: ++n })))

    const a = yield* access(state, one)
    const b = yield* access(state, two)
    const c = yield* access(state, one)

    expect(a).toBe(c)
    expect(a).not.toBe(b)
    expect(n).toBe(2)
  }),
)

it.live("InstanceState invalidates on reload", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const seen: string[] = []
    let n = 0
    const state = yield* InstanceState.make(() =>
      Effect.acquireRelease(
        Effect.sync(() => ({ n: ++n })),
        (value) =>
          Effect.sync(() => {
            seen.push(String(value.n))
          }),
      ),
    )

    const a = yield* access(state, dir)
    yield* Effect.promise(() => reloadTestInstance({ directory: dir }))
    const b = yield* access(state, dir)

    expect(a).not.toBe(b)
    expect(seen).toEqual(["1"])
  }),
)

it.live("InstanceState invalidates on disposeAll", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirScoped()
    const two = yield* tmpdirScoped()
    const seen: string[] = []
    const state = yield* InstanceState.make((ctx) =>
      Effect.acquireRelease(
        Effect.sync(() => ({ dir: ctx.directory })),
        (value) =>
          Effect.sync(() => {
            seen.push(value.dir)
          }),
      ),
    )

    yield* access(state, one)
    yield* access(state, two)
    yield* Effect.promise(disposeAllInstances)

    expect(seen.sort()).toEqual([one, two].sort())
  }),
)

it.live("InstanceState disposal completes when a finalizer hangs", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const previous = process.env.NAVI_DISPOSE_TIMEOUT_MS
    process.env.NAVI_DISPOSE_TIMEOUT_MS = "50"
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.NAVI_DISPOSE_TIMEOUT_MS
        else process.env.NAVI_DISPOSE_TIMEOUT_MS = previous
      }),
    )

    const state = yield* InstanceState.make((ctx) =>
      Effect.acquireRelease(Effect.succeed(ctx.directory), () => Effect.never),
    )
    yield* access(state, dir)

    const started = Date.now()
    yield* Effect.promise(disposeAllInstances)

    expect(Date.now() - started).toBeLessThan(2_000)
  }),
)

it.live("InstanceState.get reads the current directory lazily", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirScoped()
    const two = yield* tmpdirScoped()

    interface Api {
      readonly get: () => Effect.Effect<string>
    }

    class Test extends Context.Service<Test, Api>()("@test/InstanceStateLazy") {
      static readonly layer = Layer.effect(
        Test,
        Effect.gen(function* () {
          const state = yield* InstanceState.make((ctx) => Effect.sync(() => ctx.directory))
          const get = InstanceState.get(state)

          return Test.of({
            get: Effect.fn("Test.get")(function* () {
              return yield* get
            }),
          })
        }),
      )
    }

    yield* Effect.gen(function* () {
      const a = yield* Test.use((svc) => svc.get()).pipe(provideInstance(one))
      const b = yield* Test.use((svc) => svc.get()).pipe(provideInstance(two))

      expect(a).toBe(one)
      expect(b).toBe(two)
    }).pipe(Effect.provide(Test.layer))
  }),
)

it.live("InstanceState preserves directory across async boundaries", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirGitScoped
    const two = yield* tmpdirGitScoped
    const three = yield* tmpdirGitScoped

    interface Api {
      readonly get: () => Effect.Effect<{ directory: string; worktree: string; project: string }>
    }

    class Test extends Context.Service<Test, Api>()("@test/InstanceStateAsync") {
      static readonly layer = Layer.effect(
        Test,
        Effect.gen(function* () {
          const state = yield* InstanceState.make((ctx) =>
            Effect.sync(() => ({
              directory: ctx.directory,
              worktree: ctx.worktree,
              project: ctx.project.id,
            })),
          )

          return Test.of({
            get: Effect.fn("Test.get")(function* () {
              yield* Effect.promise(() => Bun.sleep(1))
              yield* Effect.sleep(Duration.millis(1))
              for (let i = 0; i < 100; i++) {
                yield* Effect.yieldNow
              }
              for (let i = 0; i < 100; i++) {
                yield* Effect.promise(() => Promise.resolve())
              }
              yield* Effect.sleep(Duration.millis(2))
              yield* Effect.promise(() => Bun.sleep(1))
              return yield* InstanceState.get(state)
            }),
          })
        }),
      )
    }

    yield* Effect.gen(function* () {
      const [a, b, c] = yield* Effect.all(
        [one, two, three].map((dir) => Test.use((svc) => svc.get()).pipe(provideInstance(dir))),
        { concurrency: "unbounded" },
      )

      if (!a) throw new Error("expected result a")
      if (!b) throw new Error("expected result b")
      if (!c) throw new Error("expected result c")
      expect(a).toEqual({ directory: one, worktree: one, project: a.project })
      expect(b).toEqual({ directory: two, worktree: two, project: b.project })
      expect(c).toEqual({ directory: three, worktree: three, project: c.project })
      expect(a.project).not.toBe(b.project)
      expect(a.project).not.toBe(c.project)
      expect(b.project).not.toBe(c.project)
    }).pipe(Effect.provide(Test.layer))
  }),
)

it.live("InstanceState survives high-contention concurrent access", () =>
  Effect.gen(function* () {
    const dirs = yield* Effect.all(
      Array.from({ length: 20 }, () => tmpdirScoped()),
      { concurrency: "unbounded" },
    )

    interface Api {
      readonly get: () => Effect.Effect<string>
    }

    class Test extends Context.Service<Test, Api>()("@test/HighContention") {
      static readonly layer = Layer.effect(
        Test,
        Effect.gen(function* () {
          const state = yield* InstanceState.make((ctx) => Effect.sync(() => ctx.directory))

          return Test.of({
            get: Effect.fn("Test.get")(function* () {
              for (let i = 0; i < 10; i++) {
                yield* Effect.promise(() => Bun.sleep(deterministicDelayMs(i)))
                yield* Effect.yieldNow
                yield* Effect.promise(() => Promise.resolve())
              }
              return yield* InstanceState.get(state)
            }),
          })
        }),
      )
    }

    yield* Effect.gen(function* () {
      const results = yield* Effect.all(
        dirs.map((dir) => Test.use((svc) => svc.get()).pipe(provideInstance(dir))),
        { concurrency: "unbounded" },
      )

      expect(results).toEqual(dirs)
    }).pipe(Effect.provide(Test.layer))
  }),
)

it.live("InstanceState correct after interleaved init and dispose", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirScoped()
    const two = yield* tmpdirScoped()

    interface Api {
      readonly get: () => Effect.Effect<string>
    }

    class Test extends Context.Service<Test, Api>()("@test/InterleavedDispose") {
      static readonly layer = Layer.effect(
        Test,
        Effect.gen(function* () {
          const state = yield* InstanceState.make((ctx) =>
            Effect.promise(async () => {
              await Bun.sleep(5)
              return ctx.directory
            }),
          )

          return Test.of({
            get: Effect.fn("Test.get")(function* () {
              return yield* InstanceState.get(state)
            }),
          })
        }),
      )
    }

    yield* Effect.gen(function* () {
      const a = yield* Test.use((svc) => svc.get()).pipe(provideInstance(one))
      expect(a).toBe(one)

      const [, b] = yield* Effect.all(
        [
          Effect.promise(() => reloadTestInstance({ directory: one })),
          Test.use((svc) => svc.get()).pipe(provideInstance(two)),
        ],
        { concurrency: "unbounded" },
      )
      if (!b) throw new Error("expected result b")
      expect(b).toBe(two)

      const c = yield* Test.use((svc) => svc.get()).pipe(provideInstance(one))
      expect(c).toBe(one)
    }).pipe(Effect.provide(Test.layer))
  }),
)

it.live("InstanceState mutation in one directory does not leak to another", () =>
  Effect.gen(function* () {
    const one = yield* tmpdirScoped()
    const two = yield* tmpdirScoped()
    const state = yield* InstanceState.make(() => Effect.sync(() => ({ count: 0 })))

    const s1 = yield* access(state, one)
    s1.count = 42

    const s2 = yield* access(state, two)
    expect(s2.count).toBe(0)

    const s1again = yield* access(state, one)
    expect(s1again.count).toBe(42)
    expect(s1again).toBe(s1)
  }),
)

it.live("InstanceState dedupes concurrent lookups", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    let n = 0
    const state = yield* InstanceState.make(() =>
      Effect.promise(async () => {
        n += 1
        await Bun.sleep(10)
        return { n }
      }),
    )

    const [a, b] = yield* Effect.all([access(state, dir), access(state, dir)], { concurrency: "unbounded" })
    if (!a) throw new Error("expected result a")
    if (!b) throw new Error("expected result b")
    expect(a).toBe(b)
    expect(n).toBe(1)
  }),
)

it.live("InstanceState survives deferred resume from the same instance context", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })

    interface Api {
      readonly get: (gate: Deferred.Deferred<void>) => Effect.Effect<string>
    }

    class Test extends Context.Service<Test, Api>()("@test/DeferredResume") {
      static readonly layer = Layer.effect(
        Test,
        Effect.gen(function* () {
          const state = yield* InstanceState.make((ctx) => Effect.sync(() => ctx.directory))

          return Test.of({
            get: Effect.fn("Test.get")(function* (gate: Deferred.Deferred<void>) {
              yield* Deferred.await(gate)
              return yield* InstanceState.get(state)
            }),
          })
        }),
      )
    }

    yield* Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      const fiber = yield* Test.use((svc) => svc.get(gate)).pipe(provideInstance(dir), Effect.forkScoped)

      yield* Deferred.succeed(gate, undefined).pipe(provideInstance(dir))
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value).toBe(dir)
    }).pipe(Effect.provide(Test.layer))
  }),
)

it.live("InstanceState survives deferred resume outside ALS when InstanceRef is set", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped({ git: true })

    interface Api {
      readonly get: (gate: Deferred.Deferred<void>) => Effect.Effect<string>
    }

    class Test extends Context.Service<Test, Api>()("@test/DeferredResumeOutside") {
      static readonly layer = Layer.effect(
        Test,
        Effect.gen(function* () {
          const state = yield* InstanceState.make((ctx) => Effect.sync(() => ctx.directory))

          return Test.of({
            get: Effect.fn("Test.get")(function* (gate: Deferred.Deferred<void>) {
              yield* Deferred.await(gate)
              return yield* InstanceState.get(state)
            }),
          })
        }),
      )
    }

    yield* Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      const fiber = yield* Test.use((svc) => svc.get(gate)).pipe(provideInstance(dir), Effect.forkScoped)

      yield* Deferred.succeed(gate, undefined)
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value).toBe(dir)
    }).pipe(Effect.provide(Test.layer))
  }),
)

describe("shutdown watchdog", () => {
  test("grace defaults to 3s and is clamped to 500ms..30s", () => {
    expect(withEnv("NAVI_SHUTDOWN_TIMEOUT_MS", undefined, shutdownTimeoutMs)).toBe(3_000)
    expect(withEnv("NAVI_SHUTDOWN_TIMEOUT_MS", "750", shutdownTimeoutMs)).toBe(750)
    expect(withEnv("NAVI_SHUTDOWN_TIMEOUT_MS", "10", shutdownTimeoutMs)).toBe(500)
    expect(withEnv("NAVI_SHUTDOWN_TIMEOUT_MS", "120000", shutdownTimeoutMs)).toBe(30_000)
    expect(withEnv("NAVI_SHUTDOWN_TIMEOUT_MS", "not-a-number", shutdownTimeoutMs)).toBe(3_000)
  })

  test("is a no-op under NODE_ENV=test", () => {
    withEnv("NODE_ENV", "test", () => {
      const disarm = scheduleShutdownExit(500)
      expect(shutdownExitArmed()).toBe(false)
      disarm()
      cancelShutdownExit()
    })
  })

  test("flushStdio waits for the pending write to drain", async () => {
    const original = process.stdout.write
    let release: (() => void) | undefined
    const order: string[] = []
    // Intercept only the drain write so the bounded race is observable.
    process.stdout.write = ((_chunk: never, callback?: never) => {
      if (typeof callback === "function") release = callback as () => void
      return true
    }) as typeof process.stdout.write
    try {
      const flushing = flushStdio().then(() => order.push("flushed"))
      await Bun.sleep(10)
      expect(release).toBeDefined()
      expect(order).toEqual([])
      release!()
      await flushing
      expect(order).toEqual(["flushed"])
    } finally {
      process.stdout.write = original
    }
  })

  test("forces exit after the configured grace without losing buffered output", async () => {
    const registry = pathToFileURL(path.join(import.meta.dir, "../../src/effect/instance-registry.ts")).href
    const script = [
      `import { scheduleShutdownExit } from ${JSON.stringify(registry)}`,
      `process.stdout.write("out-before-exit\\n")`,
      `process.stderr.write("err-before-exit\\n")`,
      `process.exitCode = 7`,
      `scheduleShutdownExit(500)`,
      // Keep the event loop alive so only the watchdog can end the process.
      `setInterval(() => {}, 1000)`,
    ].join("\n")
    const started = Date.now()
    const proc = Bun.spawn([process.execPath, "--eval", script], {
      cwd: path.join(import.meta.dir, "../.."),
      env: { ...process.env, NODE_ENV: "production", NAVI_SHUTDOWN_TIMEOUT_MS: "500" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    const elapsed = Date.now() - started

    expect(code).toBe(7)
    expect(stdout).toContain("out-before-exit")
    expect(stderr).toContain("err-before-exit")
    expect(elapsed).toBeGreaterThanOrEqual(400)
    expect(elapsed).toBeLessThan(20_000)
  })
})
