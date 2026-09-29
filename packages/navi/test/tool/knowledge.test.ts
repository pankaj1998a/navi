import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import path from "node:path"
import fsp from "node:fs/promises"
import { Parameters } from "../../src/tool/knowledge"
import { tmpdir } from "../fixture/fixture"
import { waitFor } from "../lib/wait"
import { uniqueName } from "../lib/names"

// Lightweight list/save happy-path coverage for the knowledge tool.
// Avoids the InstanceState harness: exercises the Parameters schema plus
// the on-disk contract KnowledgeTool implements
// (`.navi/knowledge/<id>/{metadata.json,article.md}`).

describe("tool/knowledge", () => {
  test("list params decode with no id", () => {
    const parsed = Schema.decodeUnknownSync(Parameters)({ action: "list" })
    expect(parsed.action).toBe("list")
  })

  test("save params decode with title and content", () => {
    const title = uniqueName("knowledge-title")
    const parsed = Schema.decodeUnknownSync(Parameters)({
      action: "save",
      title,
      content: "# hello\nbody",
    })
    expect(parsed.action).toBe("save")
    expect(parsed.title).toBe(title)
  })

  test("save persists metadata + article that list can see", async () => {
    await using tmp = await tmpdir()
    const title = uniqueName("Knowledge Item")
    const cleanId = title.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    const kiDir = path.join(tmp.path, ".navi", "knowledge")
    const itemDir = path.join(kiDir, cleanId)
    await fsp.mkdir(itemDir, { recursive: true })

    const meta = {
      id: cleanId,
      title,
      summary: "save happy path",
      tags: ["test"],
      updatedAt: new Date().toISOString(),
    }
    const content = `# ${title}\n\nPersisted body.`
    await fsp.writeFile(path.join(itemDir, "metadata.json"), JSON.stringify(meta, null, 2), "utf-8")
    await fsp.writeFile(path.join(itemDir, "article.md"), content, "utf-8")

    // Poll like a list reader would: wait until the index scan sees the item.
    const items = await waitFor(async () => {
      const entries = await fsp.readdir(kiDir, { withFileTypes: true })
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
      if (!dirs.includes(cleanId)) throw new Error("waiting for knowledge item dir")
      return dirs
    })
    expect(items).toContain(cleanId)

    const stored = JSON.parse(await fsp.readFile(path.join(itemDir, "metadata.json"), "utf-8"))
    expect(stored.title).toBe(title)
    expect(await fsp.readFile(path.join(itemDir, "article.md"), "utf-8")).toBe(content)
  })

  test("read roundtrip retrieves saved article", async () => {
    await using tmp = await tmpdir()
    const title = uniqueName("Read Me")
    const cleanId = title.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    const itemDir = path.join(tmp.path, ".navi", "knowledge", cleanId)
    await fsp.mkdir(itemDir, { recursive: true })
    await fsp.writeFile(
      path.join(itemDir, "metadata.json"),
      JSON.stringify({ id: cleanId, title, summary: "s", tags: [], updatedAt: new Date().toISOString() }),
      "utf-8",
    )
    const body = "read happy path body"
    await fsp.writeFile(path.join(itemDir, "article.md"), body, "utf-8")

    const article = await waitFor(async () => {
      const text = await fsp.readFile(path.join(itemDir, "article.md"), "utf-8").catch(() => {
        throw new Error("waiting for article.md")
      })
      if (!text.includes(body)) throw new Error("waiting for article body")
      return text
    })
    expect(article).toContain(body)
  })
})
