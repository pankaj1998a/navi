import { Schema } from "effect"
import { unknown, type Unknown } from "./evidence"

export const AsarEntry = Schema.Struct({
  path: Schema.String,
  size: Schema.Number,
  offset: Schema.Number,
  unpacked: Schema.Boolean,
  executable: Schema.Boolean,
  integrity: Schema.optional(Schema.String),
})

export type AsarEntry = Schema.Schema.Type<typeof AsarEntry>

export const AsarInventory = Schema.Struct({
  entries: Schema.Number,
  files: Schema.Array(AsarEntry),
  dataStart: Schema.Number,
  unknowns: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
})

export type AsarInventory = Schema.Schema.Type<typeof AsarInventory>

class Cut extends Error {}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

const isJsonObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v)

const u32 = (bytes: Buffer, off: number): number => {
  if (off < 0 || off + 4 > bytes.length) throw new Cut("ASAR header outside artifact bytes")
  return bytes.readUInt32LE(off)
}

const need = (cond: boolean, message: string): void => {
  if (!cond) throw new Cut(message)
}

const parseHeader = (bytes: Buffer): { header: { [key: string]: Json }; dataStart: number } => {
  if (bytes.length < 16) throw new Cut("Too small for an ASAR container.")
  need(u32(bytes, 0) === 4, "ASAR size pickle invalid.")
  const size = u32(bytes, 4)
  need(size >= 12 && 8 + size <= bytes.length, "ASAR header size outside artifact bytes.")
  need(u32(bytes, 8) + 4 === size, "ASAR header pickle invalid.")
  const jsonLen = u32(bytes, 12)
  need(jsonLen > 0 && jsonLen <= size - 8, "ASAR header JSON outside its pickle.")
  let header: unknown
  try {
    header = JSON.parse(bytes.toString("utf8", 16, 16 + jsonLen))
  } catch {
    throw new Cut("ASAR header JSON malformed.")
  }
  if (!isJsonObject(header)) throw new Cut("ASAR header is not an object.")
  return { header, dataStart: 8 + size }
}

const walkFiles = (node: Json, prefix: string, out: AsarEntry[]): void => {
  const obj = isJsonObject(node) ? node : undefined
  if (!obj) throw new Cut("ASAR header node is not an object.")
  const files = obj["files"]
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Cut("ASAR header has no files tree.")
  for (const [name, child] of Object.entries(isJsonObject(files) ? files : {})) {
    const rel = prefix ? `${prefix}/${name}` : name
    const entry = isJsonObject(child) ? child : undefined
    if (!entry) throw new Cut(`ASAR entry is not an object: ${rel}`)
    if (typeof entry["files"] === "object" && entry["files"] !== null) {
      walkFiles(child, rel, out)
      continue
    }
    if (typeof entry["link"] === "string") {
      out.push({ path: rel, size: 0, unpacked: false, executable: false, offset: 0 })
      continue
    }
    const size = typeof entry["size"] === "number" ? entry["size"] : 0
    const offset = typeof entry["offset"] === "string" ? Number(entry["offset"]) : 0
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Cut(`ASAR entry has a bad offset: ${rel}`)
    const integrity = entry["integrity"]
    const algorithm = isJsonObject(integrity) && typeof integrity["algorithm"] === "string" ? integrity["algorithm"] : undefined
    const digest = isJsonObject(integrity) && typeof integrity["hash"] === "string" ? integrity["hash"] : undefined
    const hash = algorithm === "SHA256" && digest && /^[a-f0-9]{64}$/.test(digest) ? digest : undefined
    out.push({
      path: rel,
      size,
      unpacked: entry["unpacked"] === true,
      executable: entry["executable"] === true,
      offset,
      ...(hash ? { integrity: hash } : {}),
    })
  }
}

export const inventoryAsar = (bytes: Buffer): AsarInventory => {
  const unknowns: Unknown[] = []
  try {
    const { header, dataStart } = parseHeader(bytes)
    const files: AsarEntry[] = []
    walkFiles(header, "", files)
    for (const f of files) {
      if (!f.unpacked && (f.offset < 0 || dataStart + f.offset + f.size > bytes.length)) {
        throw new Cut(`ASAR entry range outside container: ${f.path}`)
      }
    }
    const symlinks = files.filter((f) => f.size === 0 && !f.unpacked && f.offset === 0)
    if (symlinks.length > 0) unknowns.push(unknown("omission", `${symlinks.length} symlink entries reported without targets.`))
    return { entries: files.length, files, dataStart, unknowns }
  } catch (error) {
    if (error instanceof Cut) {
      return { entries: 0, files: [], dataStart: 0, unknowns: [unknown("format", `Not a readable ASAR: ${error.message}`)] }
    }
    throw error
  }
}

export const readAsarEntry = (bytes: Buffer, inv: AsarInventory, entry: AsarEntry): Buffer | undefined => {
  if (entry.unpacked) return undefined
  return bytes.subarray(inv.dataStart + entry.offset, inv.dataStart + entry.offset + entry.size)
}

export * as ReverseAsar from "./asar"
