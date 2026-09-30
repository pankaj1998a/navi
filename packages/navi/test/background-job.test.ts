import { describe, expect } from "bun:test"
import { Effect, Deferred, Scope, Fiber } from "effect"
import { BackgroundJob } from "@/background-job"
import { testEffect } from "./lib/effect"

const it = testEffect(BackgroundJob.layer)

describe("BackgroundJob", () => {
  it.effect("should start and complete a job", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const job = yield* background.start({
        type: "test",
        title: "Test Job",
        run: Effect.succeed("hello world"),
      })

      expect(job.status).toBe("running")
      expect(job.type).toBe("test")
      expect(job.title).toBe("Test Job")

      const waitResult = yield* background.wait({ id: job.id })
      expect(waitResult.timedOut).toBe(false)
      expect(waitResult.info?.status).toBe("completed")
      expect(waitResult.info?.output).toBe("hello world")

      const getJob = yield* background.get(job.id)
      expect(getJob?.status).toBe("completed")
      expect(getJob?.output).toBe("hello world")
    }),
  )

  it.effect("should get a job and list jobs", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const job1 = yield* background.start({
        type: "test1",
        run: Effect.succeed("result1"),
      })
      const job2 = yield* background.start({
        type: "test2",
        run: Effect.succeed("result2"),
      })

      const list = yield* background.list()
      expect(list.map((j) => j.id)).toContain(job1.id)
      expect(list.map((j) => j.id)).toContain(job2.id)

      const getJob1 = yield* background.get(job1.id)
      expect(getJob1?.type).toBe("test1")
    }),
  )

  it.effect("should handle job failures", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const job = yield* background.start({
        type: "test",
        run: Effect.fail("failed execution"),
      })

      const waitResult = yield* background.wait({ id: job.id })
      expect(waitResult.info?.status).toBe("error")
      expect(waitResult.info?.error).toBe("failed execution")
    }),
  )

  it.effect("should cancel a running job", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* background.start({
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(job.status).toBe("running")

      const cancelledJob = yield* background.cancel(job.id)
      expect(cancelledJob?.status).toBe("cancelled")

      const waitResult = yield* background.wait({ id: job.id })
      expect(waitResult.info?.status).toBe("cancelled")
    }),
  )

  it.effect("should extend a running job", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const latch1 = yield* Deferred.make<void>()
      const latch2 = yield* Deferred.make<void>()

      const job = yield* background.start({
        type: "test",
        run: Deferred.await(latch1).pipe(Effect.as("first")),
      })

      const extended = yield* background.extend({
        id: job.id,
        run: Deferred.await(latch2).pipe(Effect.as("second")),
      })
      expect(extended).toBe(true)

      // Resolve first part, should still be running because extended part is pending
      yield* Deferred.succeed(latch1, undefined)
      // Yield to scheduler to let the fibers run
      yield* Effect.yieldNow

      const runningJob = yield* background.get(job.id)
      expect(runningJob?.status).toBe("running")

      // Resolve second part, should now complete
      yield* Deferred.succeed(latch2, undefined)
      const waitResult = yield* background.wait({ id: job.id })
      expect(waitResult.info?.status).toBe("completed")
      expect(waitResult.info?.output).toBe("second")
    }),
  )

  it.effect("should support promotion and waiting for promotion", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const latch = yield* Deferred.make<void>()
      const job = yield* background.start({
        type: "test",
        run: Deferred.await(latch).pipe(Effect.as("done")),
      })

      expect(job.metadata?.background).toBeUndefined()

      const promotedJob = yield* background.promote(job.id)
      expect(promotedJob?.metadata?.background).toBe(true)

      const awaitedPromotedJob = yield* background.waitForPromotion(job.id)
      expect(awaitedPromotedJob.metadata?.background).toBe(true)

      // Complete the job
      yield* Deferred.succeed(latch, undefined)
      yield* background.wait({ id: job.id })
    }),
  )
})
