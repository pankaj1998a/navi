import { afterEach, describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@navi-ai/core/cross-spawn-spawner"
import { Effect, Fiber, Layer } from "effect"
import { InstanceRef } from "../../src/effect/instance-ref"
import { registerDisposer, cancelShutdownExit, shutdownExitArmed } from "../../src/effect/instance-registry"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstances, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

let bootstrapRun: Effect.Effect<void> = Effect.void
const noopBootstrap = Layer.succeed(
  InstanceBootstrap.Service,
  InstanceBootstrap.Service.of({ run: Effect.suspend(() => bootstrapRun) }),
)

const it = testEffect(
  Layer.mergeAll(InstanceStore.defaultLayer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(noopBootstrap)),
)

afterEach(async () => {
  bootstrapRun = Effect.void
  await disposeAllInstances()
})

describe("InstanceStore", () => {
  it.live("loads instance context without installing ALS for the caller", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const ctx = yield* store.load({ directory: dir })

      expect(ctx.directory).toBe(dir)
      expect(ctx.worktree).toBe(dir)
      expect(() => Instance.current).toThrow()
    }),
  )

  it.live("runs bootstrap with InstanceRef provided", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let initializedDirectory: string | undefined

      bootstrapRun = Effect.gen(function* () {
        initializedDirectory = (yield* InstanceRef)?.directory
      })
      yield* store.load({ directory: dir })

      expect(initializedDirectory).toBe(dir)
      expect(() => Instance.current).toThrow()
    }),
  )

  it.live("caches loaded instance context by directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let initialized = 0

      bootstrapRun = Effect.sync(() => {
        initialized++
      })
      const first = yield* store.load({ directory: dir })
      const second = yield* store.load({ directory: dir })

      expect(second).toBe(first)
      expect(initialized).toBe(1)
    }),
  )

  it.live("dedupes concurrent loads while init is in flight", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let initialized = 0

      bootstrapRun = Effect.promise(async () => {
        initialized++
        started.resolve()
        await release.promise
      })
      const first = yield* store.load({ directory: dir }).pipe(Effect.forkScoped)

      yield* Effect.promise(() => started.promise)

      bootstrapRun = Effect.sync(() => {
        initialized++
      })
      const second = yield* store.load({ directory: dir }).pipe(Effect.forkScoped)

      expect(initialized).toBe(1)
      release.resolve()

      const [firstCtx, secondCtx] = yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      expect(secondCtx).toBe(firstCtx)
      expect(initialized).toBe(1)
    }),
  )

  it.live("removes failed loads from the cache", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      let attempts = 0

      bootstrapRun = Effect.sync(() => {
        attempts++
        throw new Error("init failed")
      })
      const failed = yield* store.load({ directory: dir }).pipe(
        Effect.as(false),
        Effect.catchCause(() => Effect.succeed(true)),
      )

      expect(failed).toBe(true)

      bootstrapRun = Effect.sync(() => {
        attempts++
      })
      const ctx = yield* store.load({ directory: dir })

      expect(ctx.directory).toBe(dir)
      expect(attempts).toBe(2)
    }),
  )

  it.live("reload replaces the cached context", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service

      const first = yield* store.load({ directory: dir })
      const second = yield* store.reload({ directory: dir })
      const cached = yield* store.load({ directory: dir })

      expect(second).not.toBe(first)
      expect(cached).toBe(second)
    }),
  )

  it.live("stale dispose does not delete an in-flight reload", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const reloading = Promise.withResolvers<void>()
      const releaseReload = Promise.withResolvers<void>()
      const disposed: Array<string> = []
      const off = registerDisposer(async (directory) => {
        disposed.push(directory)
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      const first = yield* store.load({ directory: dir })
      bootstrapRun = Effect.promise(async () => {
        reloading.resolve()
        await releaseReload.promise
      })
      const reload = yield* store.reload({ directory: dir }).pipe(Effect.forkScoped)

      yield* Effect.promise(() => reloading.promise)
      const staleDispose = yield* store.dispose(first).pipe(Effect.forkScoped)
      releaseReload.resolve()

      const second = yield* Fiber.join(reload)
      yield* Fiber.join(staleDispose)

      expect(disposed).toEqual([dir])
      expect(yield* store.load({ directory: dir })).toBe(second)
    }),
  )

  it.live("dedupes concurrent disposeAll calls", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposing = Promise.withResolvers<void>()
      const releaseDispose = Promise.withResolvers<void>()
      const disposed: Array<string> = []
      const off = registerDisposer(async (directory) => {
        disposed.push(directory)
        disposing.resolve()
        await releaseDispose.promise
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      yield* store.load({ directory: dir })
      const first = yield* store.disposeAll().pipe(Effect.forkScoped)
      yield* Effect.promise(() => disposing.promise)
      const second = yield* store.disposeAll().pipe(Effect.forkScoped)

      expect(disposed).toEqual([dir])
      releaseDispose.resolve()
      yield* Effect.all([Fiber.join(first), Fiber.join(second)])
      expect(disposed).toEqual([dir])
    }),
  )

  it.live("re-arms disposeAll after completion", () =>
    Effect.gen(function* () {
      const dir1 = yield* tmpdirScoped({ git: true })
      const dir2 = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const disposed: Array<string> = []
      const off = registerDisposer(async (directory) => {
        disposed.push(directory)
      })
      yield* Effect.addFinalizer(() => Effect.sync(off))

      yield* store.load({ directory: dir1 })
      yield* store.disposeAll()
      expect(disposed).toEqual([dir1])

      yield* store.load({ directory: dir2 })
      yield* store.disposeAll()
      expect(disposed).toEqual([dir1, dir2])
    }),
  )

  it.live("dispose completes when a registered finalizer hangs", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const previous = process.env.NAVI_DISPOSE_TIMEOUT_MS
      process.env.NAVI_DISPOSE_TIMEOUT_MS = "50"
      const off = registerDisposer(() => new Promise<void>(() => {}))
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          off()
          if (previous === undefined) delete process.env.NAVI_DISPOSE_TIMEOUT_MS
          else process.env.NAVI_DISPOSE_TIMEOUT_MS = previous
        }),
      )

      const ctx = yield* store.load({ directory: dir })
      const started = Date.now()
      yield* store.dispose(ctx)

      expect(Date.now() - started).toBeLessThan(2_000)
    }),
  )

  it.live("disposeAll completes while a load is still in flight", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const previous = process.env.NAVI_DISPOSE_TIMEOUT_MS
      process.env.NAVI_DISPOSE_TIMEOUT_MS = "50"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          bootstrapRun = Effect.void
          if (previous === undefined) delete process.env.NAVI_DISPOSE_TIMEOUT_MS
          else process.env.NAVI_DISPOSE_TIMEOUT_MS = previous
        }),
      )

      bootstrapRun = Effect.never
      yield* store.load({ directory: dir }).pipe(Effect.forkScoped)
      // Give the forked load time to register its cache entry.
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 25)))

      const started = Date.now()
      yield* store.disposeAll()

      expect(Date.now() - started).toBeLessThan(2_000)
    }),
  )

  it.live("disposeAll does not arm the one-shot shutdown watchdog", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      const store = yield* InstanceStore.Service
      const previous = process.env.NODE_ENV
      // Prove the store does not arm even outside `bun test`; the watchdog is a
      // CLI-entry concern (`src/index.ts`), not a layer-finalizer one.
      process.env.NODE_ENV = "production"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          cancelShutdownExit()
          if (previous === undefined) delete process.env.NODE_ENV
          else process.env.NODE_ENV = previous
        }),
      )

      yield* store.load({ directory: dir })
      yield* store.disposeAll()

      expect(shutdownExitArmed()).toBe(false)
    }),
  )

  it.live("provides legacy Promise callers with instance ALS", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      const directory = yield* Effect.promise(() =>
        WithInstance.provide({
          directory: dir,
          fn: () => Instance.directory,
        }),
      )

      expect(directory).toBe(dir)
      expect(() => Instance.current).toThrow()
    }),
  )
})
