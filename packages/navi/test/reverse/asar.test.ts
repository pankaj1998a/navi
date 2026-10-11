import { expect, test } from "bun:test"
import { inventoryAsar, readAsarEntry } from "@/reverse/asar"

const u32le = (value: number): Buffer => {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value, 0)
  return out
}

const buildAsar = (files: { path: string; content: string }[]): Buffer => {
  const nodes: Record<string, { size: number; offset: string }> = {}
  const chunks: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = Buffer.from(file.content, "utf8")
    nodes[file.path] = { size: data.length, offset: String(offset) }
    offset += data.length
    chunks.push(data)
  }
  const json = Buffer.from(JSON.stringify({ files: nodes }), "utf8")
  const pad = (4 - (json.length % 4)) % 4
  const payload = Buffer.concat([u32le(json.length), json, Buffer.alloc(pad)])
  const size = 4 + payload.length
  return Buffer.concat([u32le(4), u32le(size), u32le(size - 4), payload, ...chunks])
}

test("asar inventory and read round-trip on real pickle layout", () => {
  const files = [
    { path: "index.js", content: "import { x } from \"./lib.js\";\n" },
    { path: "lib.js", content: "export const x = 2;\n" },
    { path: "package.json", content: "{\"name\":\"demo\"}" },
  ]
  const bytes = buildAsar(files)
  expect(bytes.readUInt32LE(0)).toBe(4)
  const size = bytes.readUInt32LE(4)
  expect(bytes.readUInt32LE(8)).toBe(size - 4)
  const jsonLen = bytes.readUInt32LE(12)
  expect(8 + size).toBe(16 + jsonLen + ((4 - (jsonLen % 4)) % 4))
  const inv = inventoryAsar(bytes)
  expect(inv.unknowns).toEqual([])
  expect(inv.entries).toBe(3)
  expect(inv.dataStart).toBe(8 + size)
  let cursor = 0
  for (const file of files) {
    const entry = inv.files.find((e) => e.path === file.path)
    if (!entry) throw new Error(`missing entry ${file.path}`)
    expect(entry.size).toBe(Buffer.byteLength(file.content))
    expect(entry.offset).toBe(cursor)
    expect(inv.dataStart + entry.offset + entry.size).toBeLessThanOrEqual(bytes.length)
    cursor += entry.size
    const data = readAsarEntry(bytes, inv, entry)
    if (!data) throw new Error(`unreadable entry ${file.path}`)
    expect(data.equals(Buffer.from(file.content, "utf8"))).toBe(true)
  }
})
