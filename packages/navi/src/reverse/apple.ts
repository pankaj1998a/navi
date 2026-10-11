import fs from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import { unknown, type Unknown } from "./evidence"
import { analyzeNativeBinary } from "./native"

export const AppleBundle = Schema.Struct({
  identifier: Schema.optional(Schema.String),
  executable: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  shortVersion: Schema.optional(Schema.String),
  executableArch: Schema.optional(Schema.String),
  executableKind: Schema.optional(Schema.String),
  frameworks: Schema.Array(Schema.String),
  plugins: Schema.Array(Schema.String),
  codeSigned: Schema.Boolean,
  provisioning: Schema.Boolean,
})

export type AppleBundle = Schema.Schema.Type<typeof AppleBundle>

export const AppleAnalysis = Schema.Struct({
  plistFormat: Schema.String,
  bundle: Schema.optional(AppleBundle),
  unknowns: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
})

export type AppleAnalysis = Schema.Schema.Type<typeof AppleAnalysis>

class Cut extends Error {}

const need = (cond: boolean, message: string): void => {
  if (!cond) throw new Cut(message)
}

type Plist = string | number | boolean | null | Plist[] | { [key: string]: Plist }

const decodeBplist = (bytes: Buffer): Plist => {
  need(bytes.length >= 42 && bytes.toString("ascii", 0, 8) === "bplist00", "not a binary plist")
  const trailer = bytes.subarray(bytes.length - 32)
  const offsetSize = trailer[6] ?? 0
  const refSize = trailer[7] ?? 0
  need(offsetSize >= 1 && offsetSize <= 8 && (refSize === 1 || refSize === 2 || refSize === 4 || refSize === 8), "unsupported bplist trailer")
  const numObjects = Number(trailer.readBigUInt64BE(8))
  const topObject = Number(trailer.readBigUInt64BE(16))
  const offsetTableOff = Number(trailer.readBigUInt64BE(24))
  need(numObjects > 0 && numObjects < 200000, "implausible bplist object count")
  need(offsetTableOff + numObjects * offsetSize <= bytes.length - 32, "bplist offset table outside bytes")
  const offsets: number[] = []
  for (let i = 0; i < numObjects; i += 1) {
    let v = 0
    for (let k = 0; k < offsetSize; k += 1) v = v * 256 + (bytes[offsetTableOff + i * offsetSize + k] ?? 0)
    offsets.push(v)
  }
  const cache = new Map<number, Plist>()
  const readInt = (off: number, n: number): number => {
    let v = 0n
    for (let k = 0; k < n; k += 1) v = (v << 8n) | BigInt(bytes[off + k] ?? 0)
    return Number(v)
  }
  const readSizedInt = (off: number): { value: number; size: number } => {
    const marker = bytes[off] ?? 0
    need((marker & 0xf0) === 0x10, "expected bplist int")
    const n = 1 << (marker & 0x0f)
    need(n === 1 || n === 2 || n === 4 || n === 8, "unsupported bplist int width")
    let v = 0n
    for (let k = 0; k < n; k += 1) v = (v << 8n) | BigInt(bytes[off + 1 + k] ?? 0)
    const signed = (marker & 0x0f) <= 3 ? BigInt.asIntN(n * 8, v) : v
    return { value: Number(signed), size: 1 + n }
  }
  const readRef = (off: number): number => {
    let v = 0
    for (let k = 0; k < refSize; k += 1) v = v * 256 + (bytes[off + k] ?? 0)
    return v
  }
  const decode = (idx: number): Plist => {
    need(idx >= 0 && idx < numObjects, "bplist object reference out of range")
    const hit: Plist | null | undefined = cache.get(idx)
    if (hit !== undefined) return hit
    cache.set(idx, null)
    const off = offsets[idx] ?? 0
    need(off < offsetTableOff, "bplist object outside object region")
    const marker = bytes[off] ?? 0
    const kind = marker >> 4
    const info = marker & 0x0f
    const readCount = (o: number): { count: number; size: number } => {
      if (info !== 0x0f) return { count: info, size: 1 }
      const iv = readSizedInt(o + 1)
      return { count: iv.value, size: 1 + iv.size }
    }
    let value: Plist
    if (marker === 0x00) value = null
    else if (marker === 0x08) value = false
    else if (marker === 0x09) value = true
    else if (kind === 0x1) value = readSizedInt(off).value
    else if (kind === 0x2) {
      const n = 1 << info
      value = n === 4 ? bytes.readFloatBE(off + 1) : bytes.readDoubleBE(off + 1)
    } else if (kind === 0x3) value = new Date(readInt(off + 1, 8) * 1000 + 978307200000).toISOString()
    else if (kind === 0x4) {
      const c = readCount(off)
      value = { $plist_type: "data", length: c.count }
    } else if (kind === 0x5) {
      const c = readCount(off)
      value = bytes.toString("ascii", off + c.size, off + c.size + c.count)
    } else if (kind === 0x6) {
      const c = readCount(off)
      value = bytes.toString("utf16le", off + c.size, off + c.size + c.count * 2)
    } else if (kind === 0x8) {
      value = { $plist_type: "uid", value: readInt(off + 1, info + 1) }
    } else if (kind === 0xa) {
      const c = readCount(off)
      const items: Plist[] = []
      for (let i = 0; i < c.count; i += 1) items.push(decode(readRef(off + c.size + i * refSize)))
      value = items
    } else if (kind === 0xd) {
      const c = readCount(off)
      const obj: { [key: string]: Plist } = {}
      for (let i = 0; i < c.count; i += 1) {
        const k = decode(readRef(off + c.size + i * refSize))
        const key = typeof k === "string" ? k : typeof k === "number" ? String(k) : undefined
        if (key === undefined) throw new Cut("bplist dict key is not a string")
        obj[key] = decode(readRef(off + c.size + (c.count + i) * refSize))
      }
      value = obj
    } else {
      throw new Cut(`unsupported bplist object 0x${marker.toString(16)}`)
    }
    cache.set(idx, value)
    return value
  }
  return decode(topObject)
}

const unescapeXml = (s: string): string =>
  s.replace(/&(lt|gt|amp|quot|apos);/g, (_, e: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[e] ?? `&${e};`)

const decodeXmlPlist = (text: string): Plist => {
  const tokens = text.match(/<\/?[a-zA-Z][^>]*>|[^<]+/g) ?? []
  let pos = 0
  const peek = (): string => tokens[pos] ?? ""
  const next = (): string => tokens[pos++] ?? ""
  const parseValue = (tag: string): Plist => {
    if (tag === "<true/>") return true
    if (tag === "<false/>") return false
    const name = /^<\/?([a-zA-Z]+)/.exec(tag)?.[1] ?? ""
    if (name === "dict") {
      const obj: { [key: string]: Plist } = {}
      let t = next()
      while (t !== "</dict>") {
        need(t === "<key>", "malformed XML plist dict")
        const key = unescapeXml(next())
        need(next() === "</key>", "malformed XML plist key")
        obj[key] = parseValue(next())
        t = next()
      }
      return obj
    }
    if (name === "array") {
      const items: Plist[] = []
      let t = next()
      while (t !== "</array>") {
        items.push(parseValue(t))
        t = next()
      }
      return items
    }
    if (name === "string" || name === "key") {
      let s = ""
      let t = next()
      while (t !== `</${name}>`) {
        need(!t.startsWith("<") || t.startsWith("<?") || t.startsWith("<!--"), "malformed XML plist string")
        s += t
        t = next()
      }
      return unescapeXml(s)
    }
    if (name === "integer") {
      let s = ""
      let t = next()
      while (t !== "</integer>") {
        s += t
        t = next()
      }
      const v = Number(s.trim())
      return Number.isSafeInteger(v) ? v : s.trim()
    }
    if (name === "real") {
      let s = ""
      let t = next()
      while (t !== "</real>") {
        s += t
        t = next()
      }
      return Number(s.trim())
    }
    if (name === "data") {
      let s = ""
      let t = next()
      while (t !== "</data>") {
        s += t
        t = next()
      }
      return { $plist_type: "data", length: s.replace(/\s/g, "").length }
    }
    if (name === "date") {
      let s = ""
      let t = next()
      while (t !== "</date>") {
        s += t
        t = next()
      }
      return s.trim()
    }
    throw new Cut(`unsupported XML plist element ${tag}`)
  }
  while (pos < tokens.length) {
    const t = peek()
    if (t.startsWith("<") && !t.startsWith("<?") && !t.startsWith("<!") && t.trim() !== "") break
    pos += 1
  }
  need(/^<plist[\s>]/.test(peek()), "not an XML plist")
  next()
  const value = parseValue(next())
  need(next() === "</plist>", "malformed XML plist")
  return value
}

const bundleFields = (value: Plist): { identifier?: string; executable?: string; name?: string; version?: string; shortVersion?: string } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const get = (k: string): string | undefined => {
    const v = (value as Record<string, Plist>)[k]
    return typeof v === "string" ? v : undefined
  }
  return {
    ...(get("CFBundleIdentifier") ? { identifier: get("CFBundleIdentifier") } : {}),
    ...(get("CFBundleExecutable") ? { executable: get("CFBundleExecutable") } : {}),
    ...(get("CFBundleName") ? { name: get("CFBundleName") } : {}),
    ...(get("CFBundleVersion") ? { version: get("CFBundleVersion") } : {}),
    ...(get("CFBundleShortVersionString") ? { shortVersion: get("CFBundleShortVersionString") } : {}),
  }
}

const listDir = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

export const analyzeAppleBundle = (root: string): AppleAnalysis => {
  const unknowns: Unknown[] = []
  try {
    const stat = fs.statSync(root)
    const infoPath = stat.isDirectory() ? path.join(root, "Info.plist") : stat.isFile() ? root : ""
    need(infoPath !== "" && fs.existsSync(infoPath), "no Info.plist found; pass a .app bundle or a .plist file")
    const bytes = fs.readFileSync(infoPath)
    let value: Plist
    let plistFormat: string
    if (bytes.length >= 8 && bytes.toString("ascii", 0, 8) === "bplist00") {
      value = decodeBplist(bytes)
      plistFormat = "bplist"
    } else if (bytes.toString("ascii", 0, 5) === "<?xml" || bytes.toString("utf8", 0, 200).includes("<plist")) {
      value = decodeXmlPlist(bytes.toString("utf8"))
      plistFormat = "xml"
    } else {
      return { plistFormat: "unknown", unknowns: [unknown("format", "Plist is neither bplist00 nor XML; OpenStep format unsupported.", infoPath)] }
    }
    if (value && typeof value === "object" && !Array.isArray(value) && "$archiver" in value) {
      unknowns.push(unknown("omission", "NSKeyedArchiver object graph detected; UIDs reported raw, graph resolution is a follow-up."))
    }
    const fields = bundleFields(value)
    let frameworks: string[] = []
    let plugins: string[] = []
    let codeSigned = false
    let provisioning = false
    let executableArch: string | undefined
    let executableKind: string | undefined
    if (stat.isDirectory()) {
      const frameworksDir = path.join(root, "Frameworks")
      if (fs.existsSync(frameworksDir)) {
        frameworks = listDir(frameworksDir)
          .filter((f) => f.endsWith(".framework") || f.endsWith(".dylib"))
          .toSorted()
      }
      const pluginsDir = path.join(root, "PlugIns")
      if (fs.existsSync(pluginsDir)) plugins = listDir(pluginsDir).toSorted()
      codeSigned = fs.existsSync(path.join(root, "_CodeSignature", "CodeResources"))
      provisioning = fs.existsSync(path.join(root, "embedded.mobileprovision"))
      if (fields.executable) {
        const exePath = path.join(root, fields.executable)
        const macosPath = path.join(root, "MacOS", fields.executable)
        const target = fs.existsSync(exePath) ? exePath : fs.existsSync(macosPath) ? macosPath : undefined
        if (target) {
          try {
            const native = analyzeNativeBinary(fs.readFileSync(target))
            if (native.format === "macho" || native.format === "macho-fat") {
              executableArch = native.architecture
              executableKind = native.kind
            } else {
              unknowns.push(unknown("format", `Bundle executable is ${native.format}, not Mach-O.`))
            }
          } catch (error) {
            if (error instanceof Cut) unknowns.push(unknown("format", `Bundle executable unreadable: ${error.message}`))
            else throw error
          }
        } else {
          unknowns.push(unknown("omission", `Bundle executable ${fields.executable} not found beside Info.plist.`))
        }
      }
    }
    const bundle: AppleBundle = {
      ...fields,
      frameworks,
      plugins,
      codeSigned,
      provisioning,
      ...(executableArch ? { executableArch } : {}),
      ...(executableKind ? { executableKind } : {}),
    }
    return { plistFormat, bundle, unknowns }
  } catch (error) {
    if (error instanceof Cut) {
      return { plistFormat: "unknown", unknowns: [unknown("format", error.message, root)] }
    }
    throw error
  }
}

export * as ReverseApple from "./apple"
