import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { SpillStore, type SpillLocator } from "@/tool/spill"

const lines = (count: number, prefix = "row") => Array.from({ length: count }, (_, i) => `${prefix}${i}`)

/** Mirrors the historical `saveText` preview contract (head 15 / tail 15). */
const expectedPreview = (text: string) => {
  const all = text.split("\n")
  if (all.length <= 30) return text
  return `${all.slice(0, 15).join("\n")}\n\n... [${all.length - 30} lines spilled to disk] ...\n\n${all.slice(-15).join("\n")}`
}

const readSafe = async (locator: SpillLocator, root: string) =>
  fs.readFile(path.join(root, locator.path), "utf-8")

describe("spill", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "navi-spill-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  describe("save", () => {
    test("writes the full payload and reports byte/line counts", async () => {
      const text = lines(5_000).join("\n")
      const locator = SpillStore.saveText(root, "build.log", text)

      expect(locator.lineCount).toBe(5_000)
      expect(locator.byteCount).toBe(Buffer.byteLength(text, "utf-8"))
      expect(await readSafe(locator, root)).toBe(text)
      expect(locator.path.startsWith(path.join(".navi", "spill"))).toBe(true)
      expect(path.basename(locator.path).startsWith("spill_")).toBe(true)
      expect(locator.retrievalHint).toContain(locator.id)
      expect(locator.retrievalHint).toContain(`${locator.byteCount} bytes`)
      expect(locator.retrievalHint).toContain(`${locator.lineCount} lines`)
    })

    test("preview keeps head and tail with an omitted-lines marker", async () => {
      const text = lines(10_000).join("\n")
      const locator = SpillStore.saveText(root, "build.log", text)

      expect(locator.preview).toBe(expectedPreview(text))
      expect(locator.preview).toContain("row0\n")
      expect(locator.preview).toContain("row9")
      expect(locator.preview).not.toContain("row100\n")
      expect(locator.preview).toContain(`... [${10_000 - 30} lines spilled to disk] ...`)
    })

    test("small payloads are embedded verbatim (no marker)", async () => {
      const text = lines(30).join("\n")
      const locator = SpillStore.saveText(root, "small.log", text)
      expect(locator.lineCount).toBe(30)
      expect(locator.preview).toBe(text)
    })

    test("async save matches the synchronous writer", async () => {
      const text = lines(200).join("\n") + "\n"
      const sync = SpillStore.saveText(root, "out.txt", text)
      const asyncLocator = await SpillStore.save(root, "out.txt", text)

      expect(asyncLocator.lineCount).toBe(sync.lineCount)
      expect(asyncLocator.byteCount).toBe(sync.byteCount)
      expect(asyncLocator.preview).toBe(sync.preview)
      expect(await readSafe(asyncLocator, root)).toBe(text)
      expect(await readSafe(sync, root)).toBe(text)
    })

    test("multi-byte content is not split mid-codepoint", () => {
      const text = Array.from({ length: 60 }, (_, i) => `日本語テキスト${i}😀`).join("\n")
      const locator = SpillStore.saveText(root, "utf8.log", text)
      expect(locator.byteCount).toBe(Buffer.byteLength(text, "utf-8"))
      expect(locator.lineCount).toBe(60)
      expect(locator.preview).toBe(expectedPreview(text))
      expect(locator.preview).toContain("日本語テキスト0")
      expect(locator.preview).toContain("😀")
    })
  })

  describe("readSpill", () => {
    test("returns a 1-indexed window and the total line count", async () => {
      const text = lines(40).join("\n")
      const locator = SpillStore.saveText(root, "out.txt", text)

      const result = await SpillStore.readSpill(root, locator.id, { offset: 5, limit: 3 })
      expect(result.totalLines).toBe(40)
      expect(result.content).toBe("L5: row4\nL6: row5\nL7: row6")
    })

    test("counts the trailing newline as an empty final line (split parity)", async () => {
      const text = lines(10).join("\n") + "\n"
      const locator = SpillStore.saveText(root, "out.txt", text)

      const result = await SpillStore.readSpill(root, locator.id, { offset: 11, limit: 5 })
      expect(result.totalLines).toBe(11)
      expect(result.content).toBe("L11: ")
    })

    test("reads an empty artifact as a single empty line", async () => {
      const locator = await SpillStore.save(root, "empty.txt", "")
      const result = await SpillStore.readSpill(root, locator.id)
      expect(result.totalLines).toBe(1)
      expect(result.content).toBe("L1: ")
    })

    test("query mode returns capped matches with real line numbers", async () => {
      const text = lines(500)
        .map((line, i) => (i % 100 === 7 ? `ERROR ${line}` : line))
        .join("\n")
      const locator = SpillStore.saveText(root, "out.txt", text)

      const all = await SpillStore.readSpill(root, locator.id, { query: "error" })
      expect(all.matchedLines).toBe(5)
      expect(all.totalLines).toBe(500)
      expect(all.content.split("\n")[0]).toBe("L8: ERROR row7")

      const capped = await SpillStore.readSpill(root, locator.id, { query: "error", limit: 2 })
      expect(capped.matchedLines).toBe(5)
      expect(capped.content.split("\n").length).toBe(2)
    })

    test("reads a large artifact by id prefix", async () => {
      const text = lines(50_000).join("\n")
      const locator = SpillStore.saveText(root, "big.log", text)
      const result = await SpillStore.readSpill(root, locator.id.slice(0, 20), { offset: 49_999, limit: 2 })
      expect(result.totalLines).toBe(50_000)
      expect(result.content).toBe("L49999: row49998\nL50000: row49999")
    })
  })

  describe("cleanup", () => {
    const day = 24 * 60 * 60 * 1000

    test("removes artifacts older than the retention window", async () => {
      // Write the artifacts directly: `save` schedules a fire-and-forget sweep
      // that would race with the explicit `cleanupDir` under test.
      const dir = path.join(root, ".navi", "spill")
      await fs.mkdir(dir, { recursive: true })
      const freshPath = path.join(dir, "spill_2000_fresh.txt")
      const stalePath = path.join(dir, "spill_1000_stale.txt")
      await fs.writeFile(freshPath, "fresh")
      await fs.writeFile(stalePath, "stale")

      const old = (Date.now() - 10 * day) / 1000
      await fs.utimes(stalePath, old, old)

      const removed = await SpillStore.cleanupDir(root)
      expect(removed).toBe(1)
      await expect(fs.stat(stalePath)).rejects.toThrow()
      expect((await fs.stat(freshPath)).isFile()).toBe(true)
    })

    test("caps retained artifacts, deleting the oldest first", async () => {
      const dir = path.join(root, ".navi", "spill")
      await fs.mkdir(dir, { recursive: true })
      for (let i = 0; i < 205; i++) {
        const file = path.join(dir, `spill_${1_000 + i}_seed.txt`)
        await fs.writeFile(file, "x")
        const t = (Date.now() - (205 - i) * 1000) / 1000
        await fs.utimes(file, t, t)
      }

      const removed = await SpillStore.cleanupDir(root)
      const remaining = (await fs.readdir(dir)).filter((name) => name.startsWith("spill_"))
      expect(removed).toBe(5)
      expect(remaining.length).toBe(200)
      // oldest five are gone, the newest are kept
      expect(remaining).not.toContain("spill_1000_seed.txt")
      expect(remaining).toContain("spill_1204_seed.txt")
    })

    test("ignores foreign files in the spill dir", async () => {
      const dir = path.join(root, ".navi", "spill")
      await fs.mkdir(dir, { recursive: true })
      const foreign = path.join(dir, "notes.txt")
      await fs.writeFile(foreign, "keep me")
      await SpillStore.cleanupDir(root)
      expect((await fs.stat(foreign)).isFile()).toBe(true)
    })

    test("is a no-op for a missing spill dir", async () => {
      expect(await SpillStore.cleanupDir(path.join(root, "nope"))).toBe(0)
    })
  })
})
