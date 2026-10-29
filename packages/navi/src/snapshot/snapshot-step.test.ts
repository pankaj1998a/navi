import { afterEach, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { SnapshotStep } from "@/snapshot/snapshot-step"
import { Snapshot } from "@/snapshot"
import { disposeAllInstances, provideInstance, tmpdir } from "../../test/fixture/fixture"

const timeout = 30000

afterEach(async () => {
  await disposeAllInstances()
})

function step<A, E>(
  dir: string,
  body: (snapshot: Snapshot.Interface, step: typeof SnapshotStep) => Effect.Effect<A, E, Snapshot.Service>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      return yield* body(snapshot, SnapshotStep).pipe(Effect.provideService(Snapshot.Service, snapshot))
    }).pipe(provideInstance(dir), Effect.provide(Snapshot.defaultLayer)),
  )
}

test("captures a snapshot in a git backed directory", async () => {
  await using tmp = await tmpdir({ git: true })
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const captured = yield* s.capture({ sessionID: "session-1", step: 1 })
        expect(captured).toBeDefined()
        expect(captured!.id.length).toBeGreaterThan(0)
        expect(captured!.hash.length).toBeGreaterThan(0)
        expect(captured!.path.length).toBeGreaterThan(0)
        expect(captured!.path).toBe(path.resolve(tmp.path))
      }),
  )
}, timeout)

test("captures two distinct snapshots", async () => {
  await using tmp = await tmpdir({ git: true })
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const first = yield* s.capture({ sessionID: "session-1", step: 1 })
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.txt"), "changed"))
        const second = yield* s.capture({ sessionID: "session-1", step: 2 })
        expect(first).toBeDefined()
        expect(second).toBeDefined()
        expect(first!.id).not.toBe(second!.id)
        expect(first!.hash).not.toBe(second!.hash)
      }),
  )
}, timeout)

test("capture in a non-git directory returns nothing and does not throw", async () => {
  await using tmp = await tmpdir()
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const captured = yield* s.capture({ sessionID: "session-1", step: 1 })
        expect(captured).toBeUndefined()
      }),
  )
}, timeout)

test("restoring a snapshot that does not exist does not throw", async () => {
  await using tmp = await tmpdir({ git: true })
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const restored = yield* s.restore({
          hash: "0000000000000000000000000000000000000000",
          path: tmp.path,
        })
        expect(restored).toBe(false)
      }),
  )
}, timeout)

test("restores a captured snapshot for a file", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.writeFile(path.join(tmp.path, "file.txt"), "original")
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const captured = yield* s.capture({ sessionID: "session-1", step: 1 })
        expect(captured).toBeDefined()
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "file.txt"), "modified"))
        const restored = yield* s.restore({
          hash: captured!.hash,
          path: tmp.path,
          files: [path.join(tmp.path, "file.txt")],
        })
        expect(restored).toBe(true)
        expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "file.txt"), "utf-8"))).toBe("original")
      }),
  )
}, timeout)

test("rejects a path that escapes the session directory", async () => {
  await using tmp = await tmpdir({ git: true })
  await using outside = await tmpdir()
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const captured = yield* s.capture({ sessionID: "session-1", step: 1 })
        expect(captured).toBeDefined()
        const escaped = path.join(outside.path, "file.txt")
        yield* Effect.promise(() => fs.writeFile(escaped, "outside"))
        const restored = yield* s.restore({
          hash: captured!.hash,
          path: tmp.path,
          files: [escaped],
        })
        expect(restored).toBe(false)
        expect(yield* Effect.promise(() => fs.readFile(escaped, "utf-8"))).toBe("outside")
      }),
  )
}, timeout)

test("rejects a relative path that escapes the session directory", async () => {
  await using tmp = await tmpdir({ git: true })
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const captured = yield* s.capture({ sessionID: "session-1", step: 1 })
        expect(captured).toBeDefined()
        const restored = yield* s.restore({
          hash: captured!.hash,
          path: tmp.path,
          files: ["../escaped.txt"],
        })
        expect(restored).toBe(false)
      }),
  )
}, timeout)

test("binds a captured snapshot to an assistant message", async () => {
  await using tmp = await tmpdir({ git: true })
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const captured = yield* s.capture({ sessionID: "session-2", step: 1 })
        expect(captured).toBeDefined()
        yield* s.bind({ sessionID: "session-2", messageID: "message-1", snapshot: captured })
        const found = yield* s.lookup({ sessionID: "session-2", messageID: "message-1" })
        expect(found).toBeDefined()
        expect(found!.hash).toBe(captured!.hash)
      }),
  )
}, timeout)

const checkpointRefs = (dir: string) =>
  Effect.sync(() => {
    const proc = Bun.spawnSync(["git", "for-each-ref", "--format=%(refname)", "refs/navi/checkpoints"], {
      cwd: dir,
    })
    return proc.stdout.toString().split("\n").filter(Boolean)
  })

test("a session keeps a bounded number of step snapshots", async () => {
  await using tmp = await tmpdir({ git: true })
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        // More captures than a session retains, so the oldest ones are evicted.
        for (let index = 0; index < 120; index++) {
          yield* s.bind({
            sessionID: "session-3",
            messageID: `message-${index}`,
            snapshot: {
              id: `${index}-hash`,
              hash: `hash-${index}`,
              path: tmp.path,
              sessionID: "session-3",
              step: index,
            },
          })
        }

        expect(yield* s.lookup({ sessionID: "session-3", messageID: "message-0" })).toBeUndefined()
        expect(yield* s.lookup({ sessionID: "session-3", messageID: "message-19" })).toBeUndefined()
        expect(yield* s.lookup({ sessionID: "session-3", messageID: "message-20" })).toBeDefined()
        expect(yield* s.lookup({ sessionID: "session-3", messageID: "message-119" })).toBeDefined()
      }),
  )
}, timeout)

test("an evicted snapshot releases the git ref that keeps its tree alive", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.writeFile(path.join(tmp.path, "file.txt"), "session-4")
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const captured = yield* s.capture({ sessionID: "session-4", step: 1 })
        expect(captured).toBeDefined()
        yield* s.bind({ sessionID: "session-4", messageID: "message-0", snapshot: captured })
        expect(yield* checkpointRefs(tmp.path)).toContain(`refs/navi/checkpoints/${captured!.hash}`)

        for (let index = 1; index < 120; index++) {
          yield* s.bind({
            sessionID: "session-4",
            messageID: `message-${index}`,
            snapshot: {
              id: `${index}-hash`,
              hash: `hash-${index}`,
              path: tmp.path,
              sessionID: "session-4",
              step: index,
            },
          })
        }

        expect(yield* checkpointRefs(tmp.path)).not.toContain(`refs/navi/checkpoints/${captured!.hash}`)
      }),
  )
}, timeout)

test("a snapshot another session still holds keeps its git ref", async () => {
  await using tmp = await tmpdir({ git: true })
  await fs.writeFile(path.join(tmp.path, "file.txt"), "session-5")
  await step(
    tmp.path,
    (_, s) =>
      Effect.gen(function* () {
        const captured = yield* s.capture({ sessionID: "session-5", step: 1 })
        expect(captured).toBeDefined()
        yield* s.bind({ sessionID: "session-5", messageID: "message-0", snapshot: captured })
        yield* s.bind({ sessionID: "session-6", messageID: "message-0", snapshot: captured })

        for (let index = 1; index < 120; index++) {
          yield* s.bind({
            sessionID: "session-5",
            messageID: `message-${index}`,
            snapshot: {
              id: `${index}-hash`,
              hash: `hash-${index}`,
              path: tmp.path,
              sessionID: "session-5",
              step: index,
            },
          })
        }

        expect(yield* checkpointRefs(tmp.path)).toContain(`refs/navi/checkpoints/${captured!.hash}`)
      }),
  )
}, timeout)
