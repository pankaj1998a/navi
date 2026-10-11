import { Schema } from "effect"
import { unknown, type Unknown } from "./evidence"

export const ManagedTableCount = Schema.Struct({
  table: Schema.String,
  rows: Schema.Number,
})

export type ManagedTableCount = Schema.Schema.Type<typeof ManagedTableCount>

export const ManagedAssemblyInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  culture: Schema.String,
  publicKeyPresent: Schema.Boolean,
  flags: Schema.Number,
  flagNames: Schema.Array(Schema.String),
  runtimeVersion: Schema.String,
  entryToken: Schema.Number,
  entryKind: Schema.String,
  readyToRun: Schema.Boolean,
  targetFramework: Schema.optional(Schema.String),
})

export type ManagedAssemblyInfo = Schema.Schema.Type<typeof ManagedAssemblyInfo>

export const ManagedLayoutInfo = Schema.Struct({
  machine: Schema.Number,
  architecture: Schema.String,
  optionalHeader: Schema.String,
  sections: Schema.Number,
  characteristics: Schema.Number,
})

export type ManagedLayoutInfo = Schema.Schema.Type<typeof ManagedLayoutInfo>

export const ManagedAnalysis = Schema.Struct({
  managed: Schema.Boolean,
  layout: ManagedLayoutInfo,
  moduleName: Schema.optional(Schema.String),
  assembly: Schema.optional(ManagedAssemblyInfo),
  tables: Schema.Array(ManagedTableCount),
  unknowns: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
})

export type ManagedAnalysis = Schema.Schema.Type<typeof ManagedAnalysis>

class Cut extends Error {}

const TABLE_NAMES: readonly (string | undefined)[] = [
  "Module",
  "TypeRef",
  "TypeDef",
  undefined,
  "Field",
  undefined,
  "MethodDef",
  undefined,
  "Param",
  "InterfaceImpl",
  "MemberRef",
  "Constant",
  "CustomAttribute",
  "FieldMarshal",
  "DeclSecurity",
  "ClassLayout",
  "FieldLayout",
  "StandAloneSig",
  "EventMap",
  undefined,
  "Event",
  "PropertyMap",
  undefined,
  "Property",
  "MethodSemantics",
  "MethodImpl",
  "ModuleRef",
  "TypeSpec",
  "ImplMap",
  "FieldRVA",
  "ENCLog",
  "ENCMap",
  "Assembly",
  undefined,
  undefined,
  "AssemblyRef",
  undefined,
  undefined,
  "File",
  "ExportedType",
  "ManifestResource",
  "NestedClass",
  "GenericParam",
  "MethodSpec",
  "GenericParamConstraint",
]

const REPORT_TABLES = new Set([
  "Module",
  "TypeRef",
  "TypeDef",
  "Field",
  "MethodDef",
  "Param",
  "InterfaceImpl",
  "MemberRef",
  "CustomAttribute",
  "Event",
  "Property",
  "ModuleRef",
  "Assembly",
  "AssemblyRef",
  "File",
  "ExportedType",
  "ManifestResource",
  "GenericParam",
  "MethodSpec",
])

type Ctx = {
  bytes: Buffer
  s: number
  b: number
  g: number
  rows: number[]
}

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

const machineName = (machine: number): string => {
  switch (machine) {
    case 0x014c:
      return "x86"
    case 0x8664:
      return "x86_64"
    case 0x01c0:
    case 0x01c2:
    case 0x01c4:
      return "arm"
    case 0xaa64:
      return "arm64"
    default:
      return `unknown(0x${machine.toString(16)})`
  }
}

const flagNames = (flags: number): string[] => {
  const names: string[] = []
  if (flags & 0x1) names.push("ILOnly")
  if (flags & 0x2) names.push("32BitRequired")
  if (flags & 0x4) names.push("ILLibrary")
  if (flags & 0x8) names.push("StrongNameSigned")
  if (flags & 0x10) names.push("NativeEntryPoint")
  if (flags & 0x10000) names.push("TrackDebugData")
  if (flags & 0x20000) names.push("32BitPreferred")
  return names
}

const simpleIdx = (rows: number): number => (rows >= 0x10000 ? 4 : 2)

const codedIdx = (maxRows: number, tagBits: number): number => (maxRows >= 2 ** (16 - tagBits) ? 4 : 2)

const maxOf = (ctx: Ctx, tables: number[]): number =>
  tables.reduce((m, t) => Math.max(m, ctx.rows[t] ?? 0), 0)

const typeDefOrRef = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x02, 0x01, 0x1b]), 2)
const resolutionScope = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x00, 0x1a, 0x23, 0x01]), 2)
const memberRefParent = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x02, 0x01, 0x1a, 0x06, 0x1b]), 3)
const hasCustomAttribute = (ctx: Ctx): number =>
  codedIdx(
    maxOf(ctx, [0x06, 0x04, 0x01, 0x02, 0x08, 0x09, 0x0a, 0x00, 0x0e, 0x17, 0x14, 0x11, 0x1a, 0x1b, 0x20, 0x23, 0x26, 0x27, 0x28, 0x2a, 0x2c, 0x2b]),
    5,
  )
const customAttributeType = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x06, 0x0a]), 3)
const hasConstant = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x04, 0x08, 0x17]), 2)
const hasSemantics = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x14, 0x17]), 1)
const methodDefOrRef = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x06, 0x0a]), 1)
const memberForwarded = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x04, 0x06]), 1)
const implementation = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x26, 0x23, 0x27]), 2)
const typeOrMethodDef = (ctx: Ctx): number => codedIdx(maxOf(ctx, [0x02, 0x06]), 1)

const rowSize = (ctx: Ctx, table: number): number => {
  const t = (n: number): number => simpleIdx(ctx.rows[n] ?? 0)
  switch (table) {
    case 0x00:
      return 2 + ctx.s + ctx.g * 3
    case 0x01:
      return resolutionScope(ctx) + ctx.s * 2
    case 0x02:
      return 4 + ctx.s * 2 + typeDefOrRef(ctx) + t(0x04) + t(0x06)
    case 0x03:
      return t(0x04)
    case 0x04:
      return 2 + ctx.s + ctx.b
    case 0x05:
      return t(0x06)
    case 0x06:
      return 8 + ctx.s + ctx.b + t(0x08)
    case 0x08:
      return 4 + ctx.s
    case 0x07:
      return t(0x08)
    case 0x09:
      return t(0x02) + typeDefOrRef(ctx)
    case 0x0a:
      return memberRefParent(ctx) + ctx.s + ctx.b
    case 0x0b:
      return 2 + hasConstant(ctx) + ctx.b
    case 0x0c:
      return hasCustomAttribute(ctx) + customAttributeType(ctx) + ctx.b
    case 0x0d:
      return codedIdx(maxOf(ctx, [0x04, 0x08]), 1) + ctx.b
    case 0x0e:
      return 2 + codedIdx(maxOf(ctx, [0x02, 0x06, 0x20]), 2) + ctx.b
    case 0x0f:
      return 6 + t(0x02)
    case 0x10:
      return 4 + t(0x04)
    case 0x11:
      return ctx.b
    case 0x12:
      return t(0x02) + t(0x14)
    case 0x13:
      return t(0x14)
    case 0x14:
      return 2 + ctx.s + typeDefOrRef(ctx)
    case 0x15:
      return t(0x02) + t(0x17)
    case 0x16:
      return t(0x17)
    case 0x17:
      return 2 + ctx.s + ctx.b
    case 0x18:
      return 2 + t(0x06) + hasSemantics(ctx)
    case 0x19:
      return t(0x02) + methodDefOrRef(ctx) + methodDefOrRef(ctx)
    case 0x1a:
      return ctx.s
    case 0x1b:
      return ctx.b
    case 0x1c:
      return 2 + memberForwarded(ctx) + ctx.s + t(0x1a)
    case 0x1d:
      return 4 + t(0x04)
    case 0x1e:
      return 8
    case 0x1f:
      return 4
    case 0x20:
      return 16 + ctx.b + ctx.s * 2
    case 0x23:
      return 12 + ctx.b * 2 + ctx.s * 2
    case 0x26:
      return 4 + ctx.s + ctx.b
    case 0x27:
      return 8 + ctx.s * 2 + implementation(ctx)
    case 0x28:
      return 8 + ctx.s + implementation(ctx)
    case 0x29:
      return t(0x02) + t(0x02)
    case 0x2a:
      return 4 + typeOrMethodDef(ctx) + ctx.s
    case 0x2b:
      return methodDefOrRef(ctx) + ctx.b
    case 0x2c:
      return t(0x2a) + typeDefOrRef(ctx)
    default:
      return 0
  }
}

const readHeapString = (heap: Buffer, idx: number): string => {
  if (idx <= 0 || idx >= heap.length) return ""
  const end = heap.indexOf(0, idx)
  const stop = end < 0 ? heap.length : end
  return heap.toString("utf8", idx, Math.min(stop, idx + 512))
}

const blobLength = (heap: Buffer, idx: number): number => {
  need(idx >= 0 && idx < heap.length, "blob index outside heap")
  const b0 = heap[idx] ?? 0
  if ((b0 & 0x80) === 0) return b0
  if ((b0 & 0xc0) === 0x80) {
    need(idx + 2 <= heap.length, "blob length outside heap")
    return ((b0 & 0x3f) << 8) | (heap[idx + 1] ?? 0)
  }
  if ((b0 & 0xe0) === 0xc0) {
    need(idx + 4 <= heap.length, "blob length outside heap")
    return (
      ((b0 & 0x1f) << 24) |
      ((heap[idx + 1] ?? 0) << 16) |
      ((heap[idx + 2] ?? 0) << 8) |
      (heap[idx + 3] ?? 0)
    )
  }
  throw new Cut("invalid blob length prefix")
}

const readModuleName = (ctx: Ctx, rows: number[], tableOffset: (target: number) => number, sHeap: Buffer, bytes: Buffer): string | undefined => {
  if ((rows[0x00] ?? 0) === 0) return undefined
  const mOff = tableOffset(0x00)
  need(mOff + 2 + ctx.s <= bytes.length, "Module table outside artifact bytes")
  return readHeapString(sHeap, ctx.s === 4 ? u32(bytes, mOff + 2) : u16(bytes, mOff + 2)) || undefined
}

const findTargetFramework = (usHeap: Buffer | undefined): string | undefined => {  if (!usHeap || usHeap.length < 4) return undefined
  const text = usHeap.toString("utf16le")
  const match = /\.NET[A-Za-z]*,Version=v?([\d.]+)/.exec(text)
  return match?.[1] ? match[0] : undefined
}

type PeFile = {
  machine: number
  arch: string
  optMagic: number
  optOffset: number
  sections: { vaddr: number; vsize: number; raw: number; rawSize: number }[]
  cliRva: number
  cliSize: number
  characteristics: number
}

const parsePeFile = (bytes: Buffer): PeFile => {
  need(bytes.length >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a, "not an MZ executable")
  const peOff = u32(bytes, 0x3c)
  need(u32(bytes, peOff) === 0x00004550, "PE signature invalid")
  const coff = peOff + 4
  const machine = u16(bytes, coff)
  const sectionCount = u16(bytes, coff + 2)
  need(sectionCount > 0 && sectionCount < 100, "implausible PE section count")
  const optSize = u16(bytes, coff + 16)
  const characteristics = u16(bytes, coff + 18)
  const optOffset = coff + 20
  need(optSize >= 96, "optional header too short")
  const optMagic = u16(bytes, optOffset)
  need(optMagic === 0x010b || optMagic === 0x020b, "unsupported optional header magic")
  const dirCountOff = optOffset + (optMagic === 0x010b ? 92 : 108)
  const dirOff = optOffset + (optMagic === 0x010b ? 96 : 112)
  const dirCount = u32(bytes, dirCountOff)
  let cliRva = 0
  let cliSize = 0
  if (dirCount > 14 && optSize >= dirOff - optOffset + 120) {
    cliRva = u32(bytes, dirOff + 14 * 8)
    cliSize = u32(bytes, dirOff + 14 * 8 + 4)
  }
  const secOff = optOffset + optSize
  const sections: PeFile["sections"] = []
  for (let i = 0; i < sectionCount; i += 1) {
    const o = secOff + i * 40
    need(o + 40 <= bytes.length, "section table outside artifact bytes")
    sections.push({
      vaddr: u32(bytes, o + 12),
      vsize: u32(bytes, o + 8),
      raw: u32(bytes, o + 20),
      rawSize: u32(bytes, o + 16),
    })
  }
  return { machine, arch: machineName(machine), optMagic, optOffset, sections, cliRva, cliSize, characteristics }
}

const rvaToOffset = (pe: PeFile, bytes: Buffer, rva: number, size: number, scope: string): number => {
  if (rva === 0 && size === 0) return 0
  for (const s of pe.sections) {
    const mapped = Math.max(s.vsize, s.rawSize)
    if (rva < s.vaddr) continue
    const within = rva - s.vaddr
    if (within > mapped || size > mapped - within) continue
    need(within <= s.rawSize && size <= s.rawSize - within, `${scope} has no file-backed data`)
    const off = s.raw + within
    need(off + size <= bytes.length, `${scope} leaves the artifact byte range`)
    return off
  }
  throw new Cut(`${scope} RVA is not covered by a PE section`)
}

export const parsePeFileLayout = (bytes: Buffer): PeFile => parsePeFile(bytes)

export const peRvaToOffset = (pe: PeFile, bytes: Buffer, rva: number, size: number, scope: string): number =>
  rvaToOffset(pe, bytes, rva, size, scope)

export const analyzeManagedAssembly = (bytes: Buffer): ManagedAnalysis => {
  const unknowns: Unknown[] = []
  try {
    const pe = parsePeFile(bytes)
    const layout: ManagedLayoutInfo = {
      machine: pe.machine,
      architecture: pe.arch,
      optionalHeader: pe.optMagic === 0x010b ? "pe32" : "pe32-plus",
      sections: pe.sections.length,
      characteristics: pe.characteristics,
    }
    if (pe.cliRva === 0 && pe.cliSize === 0) {
      return {
        managed: false,
        layout,
        tables: [],
        unknowns: [unknown("inference", "No CLI data directory; this is a native PE, use reverse_analyze_native.")],
      }
    }
    need(pe.cliSize >= 72, "CLI header shorter than 72 bytes")
    const cliOff = rvaToOffset(pe, bytes, pe.cliRva, 72, "cli.header")
    const cb = u32(bytes, cliOff)
    need(cb >= 72 && cb <= pe.cliSize, "CLI header size outside its directory")
    const _runtimeMajor = u16(bytes, cliOff + 4)
    const _runtimeMinor = u16(bytes, cliOff + 6)
    void _runtimeMajor
    void _runtimeMinor
    const metaRva = u32(bytes, cliOff + 8)
    const metaSize = u32(bytes, cliOff + 12)
    need(metaRva !== 0 && metaSize !== 0, "CLI metadata directory absent")
    const flags = u32(bytes, cliOff + 16)
    const entryToken = u32(bytes, cliOff + 20)
    const nativeRva = u32(bytes, cliOff + 64)
    const nativeSize = u32(bytes, cliOff + 68)
    let readyToRun = false
    if (nativeRva !== 0 && nativeSize >= 4) {
      const nativeOff = rvaToOffset(pe, bytes, nativeRva, 4, "cli.managed-native-header")
      readyToRun = u32(bytes, nativeOff) === 0x00525452
    }
    const metaOff = rvaToOffset(pe, bytes, metaRva, metaSize, "cli.metadata")
    need(u32(bytes, metaOff) === 0x424a5342, "metadata root signature is not BSJB")
    const verLen = u32(bytes, metaOff + 12)
    need(verLen <= 256, "metadata version string implausibly long")
    const runtimeVersion = bytes.toString("utf8", metaOff + 16, metaOff + 16 + verLen).replaceAll("\0", "")
    const streamBase = metaOff + 16 + ((verLen + 3) & ~3)
    const streamCount = u16(bytes, streamBase + 2)
    need(streamCount < 64, "implausible metadata stream count")
    let p = streamBase + 4
    const streams = new Map<string, { offset: number; size: number }>()
    for (let i = 0; i < streamCount; i += 1) {
      need(p + 8 <= bytes.length, "metadata stream header outside artifact bytes")
      const offset = u32(bytes, p)
      const size = u32(bytes, p + 4)
      let end = p + 8
      while (end < bytes.length && bytes[end] !== 0) end += 1
      need(end < bytes.length, "metadata stream name unterminated")
      const name = bytes.toString("utf8", p + 8, end)
      streams.set(name, { offset, size })
      p = p + 8 + ((end - (p + 8) + 1 + 3) & ~3)
    }
    const tables: ManagedTableCount[] = []
    let assembly: ManagedAssemblyInfo | undefined
    let moduleName: string | undefined
    const tilde = streams.get("#~")
    const stringsHeap = streams.get("#Strings")
    const usHeap = streams.get("#US")
    const blobHeap = streams.get("#Blob")
    const readHeap = (entry: { offset: number; size: number } | undefined): Buffer | undefined => {
      if (!entry) return undefined
      need(entry.offset + entry.size <= metaSize, "metadata stream leaves its directory")
      return bytes.subarray(metaOff + entry.offset, metaOff + entry.offset + entry.size)
    }
    const sHeap = readHeap(stringsHeap)
    const bHeap = readHeap(blobHeap)
    const uHeap = readHeap(usHeap)
    if (tilde && sHeap && bHeap) {
      const tOff = metaOff + tilde.offset
      need(tilde.size >= 24, "#~ stream too short")
      const heapSizes = bytes[tOff + 6] ?? 0
      let mask = 0n
      for (let i = 0; i < 8; i += 1) mask |= BigInt(bytes[tOff + 8 + i] ?? 0) << BigInt(i * 8)
      const rows: number[] = Array.from({ length: 64 }, () => 0)
      let rp = tOff + 24
      for (let bit = 0; bit < 64; bit += 1) {
        if ((mask >> BigInt(bit)) & 1n) {
          rows[bit] = u32(bytes, rp)
          rp += 4
        }
      }
      const ctx: Ctx = {
        bytes,
        s: heapSizes & 1 ? 4 : 2,
        b: heapSizes & 4 ? 4 : 2,
        g: heapSizes & 2 ? 4 : 2,
        rows,
      }
      const tableBase = rp
      const tableOffset = (target: number): number => {
        let off = tableBase
        for (let t = 0; t < target; t += 1) off += rowSize(ctx, t) * (rows[t] ?? 0)
        return off
      }
      for (let t = 0; t < TABLE_NAMES.length; t += 1) {
        const name = TABLE_NAMES[t]
        const count = rows[t] ?? 0
        if (name && REPORT_TABLES.has(name) && count > 0) tables.push({ table: name, rows: count })
      }
      moduleName = readModuleName(ctx, rows, tableOffset, sHeap, bytes)
      if ((rows[0x20] ?? 0) > 0) {
        const aOff = tableOffset(0x20)
        const rs = rowSize(ctx, 0x20)
        need(rs > 0 && aOff + rs <= bytes.length, "Assembly table outside artifact bytes")
        const major = u16(bytes, aOff + 4)
        const minor = u16(bytes, aOff + 6)
        const build = u16(bytes, aOff + 8)
        const revision = u16(bytes, aOff + 10)
        const aFlags = u32(bytes, aOff + 12)
        const pkIdx = ctx.b === 4 ? u32(bytes, aOff + 16) : u16(bytes, aOff + 16)
        const nameIdx = ctx.s === 4 ? u32(bytes, aOff + 16 + ctx.b) : u16(bytes, aOff + 16 + ctx.b)
        const cultIdx = ctx.s === 4 ? u32(bytes, aOff + 16 + ctx.b + ctx.s) : u16(bytes, aOff + 16 + ctx.b + ctx.s)
        const pkLen = pkIdx === 0 ? 0 : blobLength(bHeap, pkIdx)
        const entryTable = entryToken >>> 24
        assembly = {
          name: readHeapString(sHeap, nameIdx),
          version: `${major}.${minor}.${build}.${revision}`,
          culture: readHeapString(sHeap, cultIdx) || "neutral",
          publicKeyPresent: pkLen > 0,
          flags: aFlags,
          flagNames: flagNames(flags),
          runtimeVersion,
          entryToken,
          entryKind:
            entryToken === 0 ? "none (library)" : entryTable === 0x06 ? "managed method" : "native entry point",
          readyToRun,
          ...(findTargetFramework(uHeap) ? { targetFramework: findTargetFramework(uHeap) } : {}),
        }
      } else {
        unknowns.push(unknown("omission", "No Assembly table; metadata present but no assembly identity."))
      }
    } else {
      unknowns.push(
        unknown("omission", "Required metadata streams (#~/ #Strings/ #Blob) unavailable; identity unreadable."),
      )
    }
    if (!assembly) {
      unknowns.push(unknown("inference", "IL method bodies not decoded; table counts only."))
    }
    return { managed: true, layout, ...(moduleName === undefined ? {} : { moduleName: moduleName }), ...(assembly ? { assembly } : {}), tables, unknowns }
  } catch (error) {
    if (error instanceof Cut) {
      return {
        managed: false,
        layout: { machine: 0, architecture: "unknown", optionalHeader: "unknown", sections: 0, characteristics: 0 },
        tables: [],
        unknowns: [unknown("format", `Not a readable managed assembly: ${error.message}`)],
      }
    }
    throw error
  }
}

export * as ReverseManaged from "./managed"
