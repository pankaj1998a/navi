import { Schema } from "effect"
import { unknown, type Unknown } from "./evidence"

export const ApkEntry = Schema.Struct({
  name: Schema.String,
  size: Schema.Number,
  compressed: Schema.Number,
  method: Schema.String,
})

export type ApkEntry = Schema.Schema.Type<typeof ApkEntry>

export const DexInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  strings: Schema.Number,
  types: Schema.Number,
  methods: Schema.Number,
  classes: Schema.Number,
})

export type DexInfo = Schema.Schema.Type<typeof DexInfo>

export const ApkManifest = Schema.Struct({
  package: Schema.String,
  versionCode: Schema.optional(Schema.String),
  versionName: Schema.optional(Schema.String),
  minSdk: Schema.optional(Schema.String),
  targetSdk: Schema.optional(Schema.String),
  permissions: Schema.Array(Schema.String),
  debuggable: Schema.optional(Schema.Boolean),
})

export type ApkManifest = Schema.Schema.Type<typeof ApkManifest>

export const ApkAnalysis = Schema.Struct({
  entries: Schema.Number,
  files: Schema.Array(ApkEntry),
  truncated: Schema.Boolean,
  dex: Schema.Array(DexInfo),
  manifest: Schema.optional(ApkManifest),
  signatures: Schema.Array(Schema.String),
  unknowns: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
})

export type ApkAnalysis = Schema.Schema.Type<typeof ApkAnalysis>

class Cut extends Error {}

const need = (cond: boolean, message: string): void => {
  if (!cond) throw new Cut(message)
}

const u16 = (bytes: Buffer, off: number): number => {
  need(off >= 0 && off + 2 <= bytes.length, "read outside artifact bytes")
  return bytes.readUInt16LE(off)
}

const u32 = (bytes: Buffer, off: number): number => {
  need(off >= 0 && off + 4 <= bytes.length, "read outside artifact bytes")
  return bytes.readUInt32LE(off)
}

type RawEntry = { name: string; size: number; compressed: number; method: number; localOff: number }

const readZipCentralDirectory = (bytes: Buffer, maxEntries: number): { entries: RawEntry[]; truncated: boolean } => {
  need(bytes.length >= 22, "too small for a zip end record")
  let eocd = -1
  const floor = Math.max(0, bytes.length - 65557)
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i
      break
    }
  }
  need(eocd >= 0, "zip end-of-central-directory not found")
  const count = u16(bytes, eocd + 10)
  const dirSize = u32(bytes, eocd + 12)
  const dirOff = u32(bytes, eocd + 16)
  need(dirOff + dirSize <= bytes.length, "zip central directory outside artifact bytes")
  const entries: RawEntry[] = []
  let p = dirOff
  for (let i = 0; i < count; i += 1) {
    need(p + 46 <= bytes.length, "zip central entry outside artifact bytes")
    need(u32(bytes, p) === 0x02014b50, "zip central entry signature invalid")
    const method = u16(bytes, p + 10)
    const compressed = u32(bytes, p + 20)
    const size = u32(bytes, p + 24)
    const nameLen = u16(bytes, p + 28)
    const extraLen = u16(bytes, p + 30)
    const commentLen = u16(bytes, p + 32)
    const localOff = u32(bytes, p + 42)
    need(p + 46 + nameLen <= bytes.length, "zip entry name outside artifact bytes")
    const name = bytes.toString("utf8", p + 46, p + 46 + nameLen)
    entries.push({ name, size, compressed, method, localOff })
    if (entries.length >= maxEntries) return { entries, truncated: true }
    p += 46 + nameLen + extraLen + commentLen
  }
  return { entries, truncated: false }
}

const readEntryBytes = (bytes: Buffer, entry: RawEntry): Buffer | undefined => {
  if (entry.method !== 0) return undefined
  const p = entry.localOff
  if (p + 30 > bytes.length || u32(bytes, p) !== 0x04034b50) return undefined
  const nameLen = u16(bytes, p + 26)
  const extraLen = u16(bytes, p + 28)
  const start = p + 30 + nameLen + extraLen
  if (start + entry.size > bytes.length) return undefined
  return bytes.subarray(start, start + entry.size)
}

const parseDexHeader = (data: Buffer): DexInfo | undefined => {
  if (data.length < 112) return undefined
  if (data[0] !== 0x64 || data[1] !== 0x65 || data[2] !== 0x78 || data[3] !== 0x0a) return undefined
  const version = data.toString("ascii", 4, 7)
  return {
    name: "",
    version,
    strings: data.readUInt32LE(56),
    types: data.readUInt32LE(64),
    methods: data.readUInt32LE(88),
    classes: data.readUInt32LE(96),
  }
}

const readUtf8Length = (data: Buffer, off: number): { value: number; size: number } => {
  const b0 = data[off] ?? 0
  if ((b0 & 0x80) === 0) return { value: b0, size: 1 }
  return { value: ((b0 & 0x7f) << 8) | (data[off + 1] ?? 0), size: 2 }
}

const readAxmlStrings = (data: Buffer, off: number): string[] => {
  const stringCount = data.readUInt32LE(off + 8)
  const flags = data.readUInt32LE(off + 16)
  const stringsStart = data.readUInt32LE(off + 20)
  const isUtf8 = (flags & 0x100) !== 0
  need(stringCount < 100000, "implausible Android string pool size")
  const strings: string[] = []
  for (let i = 0; i < stringCount; i += 1) {
    const strOff = off + stringsStart + data.readUInt32LE(off + 28 + i * 4)
    need(strOff < data.length, "Android string outside chunk")
    if (isUtf8) {
      const utf16 = readUtf8Length(data, strOff)
      const utf8 = readUtf8Length(data, strOff + utf16.size)
      strings.push(data.toString("utf8", strOff + utf16.size + utf8.size, strOff + utf16.size + utf8.size + utf8.value))
    } else {
      const len = (data[strOff] ?? 0) | ((data[strOff + 1] ?? 0) << 8)
      strings.push(data.toString("utf16le", strOff + 2, strOff + 2 + len * 2))
    }
  }
  return strings
}

const parseBinaryManifest = (data: Buffer): ApkManifest => {
  need(data.length >= 8 && u16(data, 0) === 0x0003, "not a binary Android manifest")
  let p = 8
  let strings: string[] = []
  let manifest: ApkManifest = { package: "", permissions: [] }
  const permissions: string[] = []
  while (p + 8 <= data.length) {
    const type = u16(data, p)
    const size = u32(data, p + 4)
    need(size >= 8 && p + size <= data.length, "Android chunk outside manifest bytes")
    if (type === 0x0001) {
      strings = readAxmlStrings(data, p)
    } else if (type === 0x0102) {
      const nameIdx = data.readInt32LE(p + 12)
      const attrCount = u16(data, p + 20)
      const element = strings[nameIdx] ?? ""
      for (let a = 0; a < attrCount; a += 1) {
        const base = p + 28 + a * 20
        const attrName = strings[data.readInt32LE(base + 4)] ?? ""
        const rawValue = data.readInt32LE(base + 8)
        const dataType = data[base + 15] ?? 0
        const dataValue = data.readUInt32LE(base + 16)
        const str = (idx: number): string => (idx >= 0 ? (strings[idx] ?? "") : "")
        if (element === "manifest" && attrName === "package") manifest = { ...manifest, package: str(rawValue) }
        if (element === "manifest" && attrName === "versionCode") {
          manifest = { ...manifest, versionCode: dataType === 0x03 ? str(dataValue) : String(dataValue) }
        }
        if (element === "manifest" && attrName === "versionName") {
          manifest = { ...manifest, versionName: dataType === 0x03 ? str(dataValue) : String(dataValue) }
        }
        if (element === "uses-sdk" && attrName === "minSdkVersion") {
          manifest = { ...manifest, minSdk: dataType === 0x03 ? str(dataValue) : String(dataValue) }
        }
        if (element === "uses-sdk" && attrName === "targetSdkVersion") {
          manifest = { ...manifest, targetSdk: dataType === 0x03 ? str(dataValue) : String(dataValue) }
        }
        if (element === "uses-permission" && attrName === "name") permissions.push(str(rawValue))
        if (element === "application" && attrName === "debuggable") {
          manifest = { ...manifest, debuggable: dataType === 0x12 ? dataValue !== 0 : rawValue !== -1 }
        }
      }
    }
    if (size === 0) break
    p += size
  }
  need(manifest.package !== "", "manifest package attribute not found")
  return { ...manifest, permissions }
}

const detectApkSignatures = (bytes: Buffer, names: string[]): string[] => {
  const out: string[] = []
  if (names.some((n) => n.startsWith("META-INF/") && n.endsWith(".SF"))) out.push("v1 (JAR)")
  const magic = Buffer.from("APK Sig Block 42", "ascii")
  const idx = bytes.lastIndexOf(magic)
  if (idx > 0) {
    const pairSize = Number(bytes.readBigUInt64LE(idx - 8))
    if (pairSize > 0 && idx - 8 - pairSize >= 0) {
      let q = idx - 8 - pairSize
      const end = idx - 8
      while (q + 12 <= end) {
        const id = bytes.readUInt32LE(q + 8)
        const size = Number(bytes.readBigUInt64LE(q))
        if (id === 0x7109871a) out.push("v2")
        if (id === 0xf05368c0) out.push("v3")
        if (id === 0x1b93ad61) out.push("v3.1")
        q += 8 + size
      }
    }
  }
  return out
}

export const analyzeApk = (bytes: Buffer, maxEntries: number): ApkAnalysis => {
  const unknowns: Unknown[] = []
  try {
    const { entries, truncated } = readZipCentralDirectory(bytes, maxEntries)
    if (truncated) unknowns.push(unknown("capacity", `Stopped after ${maxEntries} entries; inventory partial.`))
    const files: ApkEntry[] = entries.map((e) => ({
      name: e.name,
      size: e.size,
      compressed: e.compressed,
      method: e.method === 0 ? "stored" : e.method === 8 ? "deflated" : `method-${e.method}`,
    }))
    const dex: DexInfo[] = []
    for (const e of entries) {
      if (!/^classes\d*\.dex$/.test(e.name.split("/").pop() ?? "")) continue
      const data = readEntryBytes(bytes, e)
      if (!data) {
        unknowns.push(unknown("omission", `Compressed dex unreadable without inflation: ${e.name}`))
        continue
      }
      const info = parseDexHeader(data)
      if (info) dex.push({ ...info, name: e.name })
      else unknowns.push(unknown("format", `Unparseable dex header: ${e.name}`))
    }
    if (dex.length === 0) unknowns.push(unknown("omission", "No classesN.dex found; not an Android runtime package?"))
    let manifest: ApkManifest | undefined
    const manifestEntry = entries.find((e) => e.name === "AndroidManifest.xml")
    if (manifestEntry) {
      const data = readEntryBytes(bytes, manifestEntry)
      if (!data) unknowns.push(unknown("omission", "Compressed manifest unreadable without inflation."))
      else {
        try {
          manifest = parseBinaryManifest(data)
        } catch (error) {
          if (error instanceof Cut) unknowns.push(unknown("format", `Binary manifest unreadable: ${error.message}`))
          else throw error
        }
      }
    } else {
      unknowns.push(unknown("omission", "AndroidManifest.xml absent."))
    }
    const signatures = detectApkSignatures(
      bytes,
      entries.map((e) => e.name),
    )
    if (signatures.length === 0) unknowns.push(unknown("inference", "No APK signatures detected; debuggable or unsigned build?"))
    return { entries: entries.length, files, truncated, dex, ...(manifest ? { manifest } : {}), signatures, unknowns }
  } catch (error) {
    if (error instanceof Cut) {
      return {
        entries: 0,
        files: [],
        truncated: false,
        dex: [],
        signatures: [],
        unknowns: [unknown("format", `Not a readable zip/APK: ${error.message}`)],
      }
    }
    throw error
  }
}

export * as ReverseApk from "./apk"
