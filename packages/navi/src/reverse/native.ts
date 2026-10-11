import { Schema } from "effect"
import { unknown, type Unknown } from "./evidence"
import { parsePeFileLayout, peRvaToOffset } from "./managed"

export const NativeSymbol = Schema.Struct({
  name: Schema.String,
  kind: Schema.String,
})

export type NativeSymbol = Schema.Schema.Type<typeof NativeSymbol>

export const NativeAnalysis = Schema.Struct({
  format: Schema.String,
  architecture: Schema.String,
  kind: Schema.String,
  entry: Schema.optional(Schema.String),
  interpreter: Schema.optional(Schema.String),
  needed: Schema.Array(Schema.String),
  imports: Schema.Array(NativeSymbol),
  importTruncated: Schema.Boolean,
  exports: Schema.Array(NativeSymbol),
  exportTruncated: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  unknowns: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
})

export type NativeAnalysis = Schema.Schema.Type<typeof NativeAnalysis>

class Cut extends Error {}

const need = (cond: boolean, message: string): void => {
  if (!cond) throw new Cut(message)
}

type Reader = {
  u16(o: number): number
  u32(o: number): number
  u64(o: number): number
  bytes: Buffer
}

const reader = (bytes: Buffer, le: boolean): Reader => {
  const check = (o: number, n: number): void => {
    need(o >= 0 && o + n <= bytes.length, "read outside artifact bytes")
  }
  return {
    bytes,
    u16: (o) => {
      check(o, 2)
      return le ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o)
    },
    u32: (o) => {
      check(o, 4)
      return le ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o)
    },
    u64: (o) => {
      check(o, 8)
      const v = le ? bytes.readBigUInt64LE(o) : bytes.readBigUInt64BE(o)
      need(v <= BigInt(Number.MAX_SAFE_INTEGER), "address beyond exact integer range")
      return Number(v)
    },
  }
}

const cstring = (bytes: Buffer, off: number, cap = 512): string => {
  need(off >= 0 && off < bytes.length, "string outside artifact bytes")
  const end = bytes.indexOf(0, off)
  const stop = end < 0 ? bytes.length : Math.min(end, off + cap)
  return bytes.toString("utf8", off, stop)
}

const elfMachine = (m: number): string => {
  const map: Record<number, string> = {
    3: "x86",
    62: "x86_64",
    40: "arm",
    183: "aarch64",
    8: "mips",
    20: "ppc",
    21: "ppc64",
    22: "s390",
    243: "riscv",
    94: "xtensa",
  }
  return map[m] ?? `machine-0x${m.toString(16)}`
}

const elfOsabi = (v: number): string => {
  const map: Record<number, string> = { 0: "sysv", 1: "hpux", 2: "netbsd", 3: "linux", 6: "solaris", 9: "freebsd", 12: "openbsd" }
  return map[v] ?? `abi-${v}`
}

const collectNotes = (
  r: Reader,
  bytes: Buffer,
  segments: { type: number; off: number; size: number }[],
  notes: string[],
  unknowns: Unknown[],
): void => {
  const walk = (off: number, size: number): void => {
    let p = off
    const end = off + size
    while (p + 12 <= end) {
      const namesz = r.u32(p)
      const descsz = r.u32(p + 4)
      const type = r.u32(p + 8)
      need(namesz < 256 && descsz < 16 * 1024 * 1024, "implausible ELF note sizes")
      const name = bytes.toString("ascii", p + 12, Math.min(p + 12 + namesz, end)).replaceAll("\0", "")
      const descOff = p + 12 + ((namesz + 3) & ~3)
      if (name === "GNU" && type === 3) {
        notes.push(`gnu-build-id ${bytes.subarray(descOff, descOff + descsz).toString("hex")}`)
      } else if (name === "GNU" && type === 1) {
        notes.push("gnu-abi-tag present")
      } else if (name === "FreeBSD" && type === 1) {
        notes.push("freebsd-abi-tag present")
      }
      p = descOff + ((descsz + 3) & ~3)
    }
  }
  for (const s of segments) {
    if (s.type !== 4) continue
    try {
      walk(s.off, s.size)
    } catch (error) {
      if (error instanceof Cut) unknowns.push(unknown("format", `Unreadable ELF note: ${error.message}`))
      else throw error
    }
  }
}

const analyzeElf = (bytes: Buffer, unknowns: Unknown[]): Omit<NativeAnalysis, "format" | "unknowns"> => {
  const cls = bytes[4] ?? 0
  need(cls === 1 || cls === 2, "unsupported ELF class")
  const le = (bytes[5] ?? 0) === 1
  need((bytes[5] ?? 0) === 1 || (bytes[5] ?? 0) === 2, "unsupported ELF data encoding")
  const r = reader(bytes, le)
  const is64 = cls === 2
  const addr = (o: number): number => (is64 ? r.u64(o) : r.u32(o))
  const type = r.u16(16)
  const machine = r.u16(18)
  const typeName = type === 0 ? "none" : type === 1 ? "relocatable" : type === 2 ? "executable" : type === 3 ? "shared-object" : type === 4 ? "core-dump" : `type-${type}`
  if (type === 4) unknowns.push(unknown("inference", "Core dump: no code to disassemble; use a recorded-crash workflow."))
  const entry = addr(24)
  const phoff = addr(is64 ? 32 : 28)
  const shoff = addr(is64 ? 40 : 32)
  const phentsize = r.u16(is64 ? 54 : 42)
  const phnum = r.u16(is64 ? 56 : 44)
  const shentsize = r.u16(is64 ? 58 : 46)
  const shnum = r.u16(is64 ? 60 : 48)
  const shstrndx = r.u16(is64 ? 62 : 50)
  need(phnum < 100 && shnum < 10000, "implausible ELF header counts")
  const notes: string[] = [`osabi ${elfOsabi(bytes[7] ?? 0)}`]
  type Prog = { type: number; flags: number; off: number; vaddr: number; filesz: number; memsz: number }
  const progs: Prog[] = []
  for (let i = 0; i < phnum; i += 1) {
    const o = phoff + i * phentsize
    if (is64) {
      progs.push({ type: r.u32(o), flags: r.u32(o + 4), off: r.u64(o + 8), vaddr: r.u64(o + 16), filesz: r.u64(o + 32), memsz: r.u64(o + 40) })
    } else {
      progs.push({ type: r.u32(o), off: r.u32(o + 4), vaddr: r.u32(o + 8), filesz: r.u32(o + 16), memsz: r.u32(o + 20), flags: r.u32(o + 24) })
    }
  }
  const loads = progs.filter((p) => p.type === 1)
  const toFile = (vaddr: number): number | undefined => {
    for (const l of loads) {
      if (vaddr >= l.vaddr && vaddr < l.vaddr + l.memsz) {
        const off = l.off + (vaddr - l.vaddr)
        if (off < bytes.length) return off
      }
    }
    return undefined
  }
  let interpreter: string | undefined
  for (const p of progs) {
    if (p.type === 3) {
      need(p.off + p.filesz <= bytes.length, "PT_INTERP outside artifact bytes")
      interpreter = cstring(bytes, p.off)
    }
  }
  collectNotes(
    r,
    bytes,
    progs.map((p) => ({ type: p.type, off: p.off, size: p.filesz })),
    notes,
    unknowns,
  )
  const needed: string[] = []
  let soname: string | undefined
  const dyn = progs.find((p) => p.type === 2)
  if (dyn) {
    need(dyn.off + dyn.filesz <= bytes.length, "PT_DYNAMIC outside artifact bytes")
    const entsz = is64 ? 16 : 8
    let strtab: number | undefined
    const pending: { tag: number; val: number }[] = []
    for (let o = dyn.off; o + entsz <= dyn.off + dyn.filesz; o += entsz) {
      const tag = is64 ? Number(bytes.readBigInt64LE(o)) : r.u32(o) >= 0x80000000 ? r.u32(o) - 0x100000000 : r.u32(o)
      const val = is64 ? r.u64(o + 8) : r.u32(o + 4)
      if (tag === 0) break
      pending.push({ tag, val })
      if (tag === 5) strtab = toFile(val)
    }
    if (strtab !== undefined) {
      for (const e of pending) {
        if (e.tag === 1) needed.push(cstring(bytes, strtab + (e.val < 0 ? 0 : e.val)))
        if (e.tag === 14) soname = cstring(bytes, strtab + e.val)
      }
    } else if (pending.some((e) => e.tag === 1)) {
      unknowns.push(unknown("omission", "DT_STRTAB unresolvable; DT_NEEDED names unavailable."))
    }
  }
  type Shdr = { name: number; type: number; flags: number; addr: number; off: number; size: number; link: number; entsize: number }
  const shdrs: Shdr[] = []
  for (let i = 0; i < shnum; i += 1) {
    const o = shoff + i * shentsize
    if (is64) {
      shdrs.push({ name: r.u32(o), type: r.u32(o + 4), flags: r.u64(o + 8), addr: r.u64(o + 16), off: r.u64(o + 24), size: r.u64(o + 32), link: r.u32(o + 40), entsize: r.u64(o + 56) })
    } else {
      shdrs.push({ name: r.u32(o), type: r.u32(o + 4), flags: r.u32(o + 8), addr: r.u32(o + 12), off: r.u32(o + 16), size: r.u32(o + 20), link: r.u32(o + 24), entsize: r.u32(o + 36) })
    }
  }
  const sectionName = (idx: number): string => {
    const strtab = shdrs[shstrndx]
    if (!strtab) return ""
    return cstring(bytes, strtab.off + idx)
  }
  if (!shdrs.some((s) => s.type === 2)) notes.push("stripped (no .symtab)")
  if (shdrs.some((s) => sectionName(s.name) === ".debug_info")) notes.push("dwarf-debug-info present")
  if (soname) notes.push(`soname ${soname}`)
  const imports: NativeSymbol[] = []
  const exports: NativeSymbol[] = []
  let importTotal = 0
  let exportTotal = 0
  for (const s of shdrs) {
    if (s.type !== 11) continue
    const strtab = shdrs[s.link]
    if (!strtab || s.entsize === 0) {
      unknowns.push(unknown("omission", "Dynamic string table unavailable; symbols unreadable."))
      continue
    }
    const count = Math.floor(s.size / s.entsize)
    need(count < 10_000_000, "implausible dynamic symbol count")
    for (let i = 0; i < count; i += 1) {
      const o = s.off + i * s.entsize
      let name: string
      let info: number
      let shndx: number
      if (is64) {
        name = cstring(bytes, strtab.off + r.u32(o))
        info = bytes[o + 4] ?? 0
        shndx = r.u16(o + 6)
      } else {
        name = cstring(bytes, strtab.off + r.u32(o))
        info = bytes[o + 12] ?? 0
        shndx = r.u16(o + 14)
      }
      if (!name) continue
      const bind = info >> 4
      const symType = info & 0xf
      const kind = symType === 2 ? "func" : symType === 1 ? "object" : "symbol"
      if (shndx === 0) {
        importTotal += 1
        if (imports.length < 200 && bind !== 0) imports.push({ name, kind })
      } else if (shndx < 0xff00 && (bind === 1 || bind === 2)) {
        exportTotal += 1
        if (exports.length < 400) exports.push({ name, kind })
      }
    }
  }
  return {
    architecture: `${elfMachine(machine)} (${is64 ? "64" : "32"}-bit ${le ? "LE" : "BE"})`,
    kind: typeName,
    entry: `0x${entry.toString(16)}`,
    ...(interpreter ? { interpreter } : {}),
    needed,
    imports: imports.toSorted((a, b) => a.name.localeCompare(b.name)),
    importTruncated: importTotal > imports.length,
    exports: exports.toSorted((a, b) => a.name.localeCompare(b.name)),
    exportTruncated: exportTotal > exports.length,
    notes,
  }
}

export const machoCpu = (c: number): string => {
  const map: Record<number, string> = { 7: "x86", 0x01000007: "x86_64", 12: "arm", 0x0100000c: "arm64" }
  return map[c] ?? `cputype-0x${c.toString(16)}`
}

export const machoFileType = (t: number): string => {
  const map: Record<number, string> = {
    1: "relocatable",
    2: "executable",
    3: "fixed-vm-library",
    4: "core",
    5: "preloaded",
    6: "dylinker",
    7: "dylib",
    8: "bundle",
  }
  return map[t] ?? `filetype-${t}`
}

export const machoPlatform = (p: number): string => {
  const map: Record<number, string> = {
    1: "macOS",
    2: "iOS",
    3: "tvOS",
    4: "watchOS",
    5: "bridgeOS",
    6: "macCatalyst",
    7: "iOS-simulator",
    8: "tvOS-simulator",
    9: "watchOS-simulator",
    10: "DriverKit",
  }
  return map[p] ?? `platform-${p}`
}

export const machoVersion = (v: number): string => `${(v >>> 16) & 0xffff}.${(v >>> 8) & 0xff}.${v & 0xff}`

export const analyzeMachoSlice = (
  bytes: Buffer,
  off: number,
  arch: string,
  _unknowns: Unknown[],
): Omit<NativeAnalysis, "format" | "unknowns"> => {
  const r = reader(bytes, true)
  const magic = r.u32(off)
  const is64 = magic === 0xfeedfacf
  need(is64 || magic === 0xfeedface, "not a Mach-O slice")
  const cputype = r.u32(off + 4)
  const filetype = r.u32(off + 12)
  const ncmds = r.u32(off + 16)
  need(ncmds < 200, "implausible Mach-O load command count")
  let p = off + (is64 ? 32 : 28)
  const notes: string[] = []
  const needed: string[] = []
  const segments: string[] = []
  let entry: string | undefined
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = r.u32(p)
    const size = r.u32(p + 4)
    need(size >= 8 && p + size <= bytes.length, "Mach-O load command outside artifact bytes")
    if (cmd === 0x19 || cmd === 0x1) {
      const name = bytes.toString("ascii", p + 8, p + 24).replaceAll("\0", "")
      segments.push(name)
    } else if (cmd === 0xc || cmd === 0x80000018 || cmd === 0x8000001f || cmd === 0x80000023 || cmd === 0xd) {
      const strOff = r.u32(p + 8)
      need(strOff < size, "dylib path outside load command")
      const kind = cmd === 0xd ? "id" : cmd === 0xc ? "linked" : "weak/reexport"
      needed.push(`${cstring(bytes, p + strOff)} (${kind})`)
    } else if (cmd === 0x80000028) {
      entry = `0x${(is64 ? r.u64(p + 8) : r.u32(p + 8)).toString(16)}`
    } else if (cmd === 0x1b) {
      notes.push(`uuid ${bytes.subarray(p + 8, p + 24).toString("hex")}`)
    } else if (cmd === 0x1d) {
      notes.push(`code-signature blob at file offset ${r.u32(p + 8)} (${r.u32(p + 12)} bytes)`)
    } else if (cmd === 0x32) {
      notes.push(`platform ${machoPlatform(r.u32(p + 8))} min-os ${machoVersion(r.u32(p + 12))} sdk ${machoVersion(r.u32(p + 16))}`)
    } else if (cmd === 0x24 || cmd === 0x25) {
      notes.push(`min-os ${machoVersion(r.u32(p + 8))} sdk ${machoVersion(r.u32(p + 12))}`)
    } else if (cmd === 0x8000001c || cmd === 0x1c) {
      const strOff = r.u32(p + 8)
      need(strOff < size, "rpath outside load command")
      notes.push(`rpath ${cstring(bytes, p + strOff)}`)
    }
    p += size
  }
  return {
    architecture: arch || machoCpu(cputype),
    kind: machoFileType(filetype),
    ...(entry ? { entry } : {}),
    needed: needed.slice(0, 100),
    imports: [],
    importTruncated: false,
    exports: [],
    exportTruncated: false,
    notes: [...notes, `segments: ${segments.join(", ") || "none"}`],
  }
}

export const analyzeMacho = (bytes: Buffer, unknowns: Unknown[]): Omit<NativeAnalysis, "format" | "unknowns"> => {
  const magic = bytes.readUInt32LE(0)
  if (magic === 0xcafebabe || magic === 0xbebafeca) {
    const be = magic === 0xbebafeca
    const r = reader(bytes, !be)
    const nfat = r.u32(4)
    need(nfat > 0 && nfat <= 8, "implausible fat binary arch count")
    const arches: string[] = []
    for (let i = 0; i < nfat; i += 1) {
      const o = 8 + i * 20
      const cpu = r.u32(o)
      const off = r.u32(o + 8)
      const size = r.u32(o + 12)
      need(off + size <= bytes.length, "fat arch outside artifact bytes")
      arches.push(`${machoCpu(cpu)}@${off}+${size}`)
    }
    const first = 8
    const firstOff = r.u32(first + 8)
    const inner = analyzeMachoSlice(bytes, firstOff, "", unknowns)
    if (nfat > 1) unknowns.push(unknown("omission", `Only the first fat arch analyzed in detail; ${nfat - 1} more listed.`))
    return { ...inner, architecture: `fat (${arches.length} archs)`, notes: [`archs: ${arches.join(", ")}`, ...inner.notes] }
  }
  const swapped = magic === 0xcefaedfe || magic === 0xcffaedfe
  if (swapped) {
    unknowns.push(unknown("format", "Byte-swapped Mach-O; only native-endian slices analyzed."))
  }
  return analyzeMachoSlice(bytes, 0, "", unknowns)
}

const readRvaString = (pe: ReturnType<typeof parsePeFileLayout>, bytes: Buffer, rva: number): string => {
  const off = peRvaToOffset(pe, bytes, rva, 1, "pe.string")
  return cstring(bytes, off)
}

const analyzePeNative = (bytes: Buffer, unknowns: Unknown[]): Omit<NativeAnalysis, "format" | "unknowns"> => {
  const pe = parsePeFileLayout(bytes)
  const dirs = (idx: number): { rva: number; size: number } => {
    const dirOff = pe.optOffset + (pe.optMagic === 0x010b ? 96 : 112) + idx * 8
    return { rva: bytes.readUInt32LE(dirOff), size: bytes.readUInt32LE(dirOff + 4) }
  }
  const notes: string[] = []
  const needed: string[] = []
  const imports: NativeSymbol[] = []
  let importTruncated = false
  const importDir = dirs(1)
  if (importDir.rva !== 0) {
    const is64 = pe.optMagic === 0x020b
    const thunk = (o: number): number => (is64 ? Number(bytes.readBigUInt64LE(o)) : bytes.readUInt32LE(o))
    const ordinalFlag = is64 ? 0x8000000000000000n : 0x80000000n
    for (let d = 0; ; d += 1) {
      const base = peRvaToOffset(pe, bytes, importDir.rva + d * 20, 20, "pe.import-descriptor")
      const oft = is64 ? Number(bytes.readBigUInt64LE(base)) : bytes.readUInt32LE(base)
      const nameRva = bytes.readUInt32LE(base + 12)
      const ft = is64 ? Number(bytes.readBigUInt64LE(base + 16)) : bytes.readUInt32LE(base + 16)
      if (oft === 0 && nameRva === 0 && ft === 0) break
      need(d < 256, "implausible PE import dll count")
      const dll = readRvaString(pe, bytes, nameRva)
      needed.push(dll)
      const table = oft !== 0 ? oft : ft
      for (let t = 0; ; t += 1) {
        const entryOff = peRvaToOffset(pe, bytes, table + t * (is64 ? 8 : 4), is64 ? 8 : 4, "pe.thunk")
        const value = thunk(entryOff)
        if (value === 0) break
        if (t > 2000) {
          importTruncated = true
          break
        }
        if ((BigInt(value) & ordinalFlag) !== 0n) {
          imports.push({ name: `${dll}!ordinal-${value & 0xffff}`, kind: "func" })
        } else {
          const nameOff = peRvaToOffset(pe, bytes, value, 2, "pe.import-name")
          imports.push({ name: `${dll}!${cstring(bytes, nameOff + 2)}`, kind: "func" })
        }
      }
      if (imports.length > 2000) {
        importTruncated = true
        break
      }
    }
  }
  const exports: NativeSymbol[] = []
  let exportTruncated = false
  const exportDir = dirs(0)
  if (exportDir.rva !== 0 && exportDir.size > 0) {
    const base = peRvaToOffset(pe, bytes, exportDir.rva, 40, "pe.export-directory")
    const nFuncs = bytes.readUInt32LE(base + 20)
    const nNames = bytes.readUInt32LE(base + 24)
    const addrFuncs = bytes.readUInt32LE(base + 28)
    const addrNames = bytes.readUInt32LE(base + 32)
    const addrOrd = bytes.readUInt32LE(base + 36)
    need(nFuncs < 100000 && nNames < 100000, "implausible PE export counts")
    const count = Math.min(nNames, 2000)
    if (nNames > count) exportTruncated = true
    for (let i = 0; i < count; i += 1) {
      const nameRva = bytes.readUInt32LE(peRvaToOffset(pe, bytes, addrNames + i * 4, 4, "pe.export-names"))
      const ordIdx = bytes.readUInt16LE(peRvaToOffset(pe, bytes, addrOrd + i * 2, 2, "pe.export-ordinals"))
      const funcRva = bytes.readUInt32LE(peRvaToOffset(pe, bytes, addrFuncs + ordIdx * 4, 4, "pe.export-addrs"))
      const name = readRvaString(pe, bytes, nameRva)
      const forwarded = funcRva >= exportDir.rva && funcRva < exportDir.rva + exportDir.size
      exports.push({ name: forwarded ? `${name} -> ${readRvaString(pe, bytes, funcRva)}` : name, kind: "func" })
    }
  }
  const debugDir = dirs(6)
  if (debugDir.rva !== 0 && debugDir.size > 0) {
    const count = Math.floor(debugDir.size / 28)
    for (let i = 0; i < Math.min(count, 16); i += 1) {
      const base = peRvaToOffset(pe, bytes, debugDir.rva + i * 28, 28, "pe.debug-entry")
      const type = bytes.readUInt32LE(base + 12)
      if (type === 2) {
        const ptr = bytes.readUInt32LE(base + 24)
        need(ptr + 24 < bytes.length, "CodeView record outside artifact bytes")
        if (bytes.toString("ascii", ptr, ptr + 4) === "RSDS") {
          notes.push(`pdb ${cstring(bytes, ptr + 24)}`)
        }
      } else {
        notes.push(`debug-type-${type} present`)
      }
    }
  }
  const peOff = bytes.readUInt32LE(0x3c)
  const richAt = bytes.lastIndexOf("Rich")
  if (richAt > 0 && richAt < peOff) notes.push("rich-header present (Microsoft toolchain)")
  if (dirs(9).rva !== 0) notes.push("tls-callbacks present")
  const clrDir = dirs(14)
  if (clrDir.rva !== 0) {
    unknowns.push(unknown("inference", "CLR data directory present; managed image, prefer reverse_analyze_managed."))
  }
  return {
    architecture: pe.arch,
    kind: pe.characteristics & 0x2000 ? "dll" : "executable",
    needed,
    imports,
    importTruncated,
    exports,
    exportTruncated,
    notes,
  }
}

export const analyzeNativeBinary = (bytes: Buffer): NativeAnalysis => {
  const unknowns: Unknown[] = []
  try {
    need(bytes.length >= 4, "artifact too small")
    if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
      return { format: "elf", ...analyzeElf(bytes, unknowns), unknowns }
    }
    if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
      return { format: "pe", ...analyzePeNative(bytes, unknowns), unknowns }
    }
    const magic = bytes.readUInt32LE(0)
    if (magic === 0xfeedface || magic === 0xfeedfacf || magic === 0xcefaedfe || magic === 0xcffaedfe || magic === 0xcafebabe || magic === 0xbebafeca) {
      return { format: bytes.length >= 8 && (magic === 0xcafebabe || magic === 0xbebafeca) ? "macho-fat" : "macho", ...analyzeMacho(bytes, unknowns), unknowns }
    }
    return {
      format: "unknown",
      architecture: "unknown",
      kind: "unknown",
      needed: [],
      imports: [],
      importTruncated: false,
      exports: [],
      exportTruncated: false,
      notes: [],
      unknowns: [unknown("format", `Unrecognized magic ${bytes.subarray(0, 4).toString("hex")}; not ELF/Mach-O/PE.`)],
    }
  } catch (error) {
    if (error instanceof Cut) {
      return {
        format: "unknown",
        architecture: "unknown",
        kind: "unknown",
        needed: [],
        imports: [],
        importTruncated: false,
        exports: [],
        exportTruncated: false,
        notes: [],
        unknowns: [unknown("format", `Not a readable native binary: ${error.message}`)],
      }
    }
    throw error
  }
}

export * as ReverseNative from "./native"
