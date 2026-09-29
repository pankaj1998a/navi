import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Scan } from "../../src/codebase/scan"

describe("codebase/scan", () => {
  test("returns [] for unsupported extensions without loading parsers", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "navi-scan-"))
    try {
      const file = path.join(dir, "notes.xyz")
      await fs.writeFile(file, "hello\n".repeat(100))
      expect(await Scan.file(file)).toEqual([])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("caps work per file: large unsupported file still returns fast", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "navi-scan-"))
    try {
      const file = path.join(dir, "big.xyz")
      await fs.writeFile(file, `x\n`.repeat(50_000))
      const started = Date.now()
      expect(await Scan.file(file)).toEqual([])
      expect(Date.now() - started).toBeLessThan(5000)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
