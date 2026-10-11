import { expect, test } from "bun:test"
import { analyzeNativeBinary } from "@/reverse/native"

const LOAD_VADDR = 0x400000
const LOAD_SIZE = 0x1000
const PHOFF = 64
const INTERP_OFF = 0x200
const NOTE_OFF = 0x240
const DYN_OFF = 0x280
const DYNSTR_OFF = 0x300
const DYNSYM_OFF = 0x340
const SHSTR_OFF = 0x3c0
const SHOFF = 0x1000

const buildElf = (): { bytes: Buffer; digestHex: string } => {
  const interp = "/lib64/ld-linux-x86-64.so.2"
  const dynNames = ["libc.so.6", "libdemo.so.1", "printf", "main", "myvar", "helper"]
  const dynstr = Buffer.from(`${dynNames.join("\0")}\0`, "utf8")
  const strOff = (n: string): number => {
    const idx = dynNames.indexOf(n)
    if (idx < 0) throw new Error(`missing dynstr entry ${n}`)
    return dynNames.slice(0, idx).reduce((acc, s) => acc + Buffer.byteLength(s, "utf8") + 1, 0)
  }
  const digest = Buffer.from(Array.from({ length: 20 }, (_, i) => i + 1))
  const shstrtab = Buffer.from("\0.dynstr\0.dynsym\0.shstrtab\0", "utf8")
  const dynCount = 5
  const symCount = 5
  const total = SHOFF + 5 * 64
  const bytes = Buffer.alloc(total)
  bytes[0] = 0x7f
  bytes.write("ELF", 1, "ascii")
  bytes[4] = 2
  bytes[5] = 1
  bytes[6] = 1
  bytes.writeUInt16LE(2, 16)
  bytes.writeUInt16LE(62, 18)
  bytes.writeUInt32LE(1, 20)
  bytes.writeBigUInt64LE(BigInt(LOAD_VADDR), 24)
  bytes.writeBigUInt64LE(BigInt(PHOFF), 32)
  bytes.writeBigUInt64LE(BigInt(SHOFF), 40)
  bytes.writeUInt16LE(64, 52)
  bytes.writeUInt16LE(56, 54)
  bytes.writeUInt16LE(4, 56)
  bytes.writeUInt16LE(64, 58)
  bytes.writeUInt16LE(5, 60)
  bytes.writeUInt16LE(4, 62)
  const phdr = (i: number, type: number, flags: number, off: number, vaddr: number, filesz: number, memsz: number): void => {
    const o = PHOFF + i * 56
    bytes.writeUInt32LE(type, o)
    bytes.writeUInt32LE(flags, o + 4)
    bytes.writeBigUInt64LE(BigInt(off), o + 8)
    bytes.writeBigUInt64LE(BigInt(vaddr), o + 16)
    bytes.writeBigUInt64LE(BigInt(vaddr), o + 24)
    bytes.writeBigUInt64LE(BigInt(filesz), o + 32)
    bytes.writeBigUInt64LE(BigInt(memsz), o + 40)
    bytes.writeBigUInt64LE(BigInt(0x1000), o + 48)
  }
  bytes.write(`${interp}\0`, INTERP_OFF, "ascii")
  phdr(0, 3, 4, INTERP_OFF, 0, Buffer.byteLength(interp, "utf8") + 1, Buffer.byteLength(interp, "utf8") + 1)
  phdr(1, 1, 5, 0, LOAD_VADDR, LOAD_SIZE, LOAD_SIZE)
  phdr(2, 2, 6, DYN_OFF, LOAD_VADDR + DYN_OFF, dynCount * 16, dynCount * 16)
  const noteSize = 12 + 4 + 20
  phdr(3, 4, 4, NOTE_OFF, 0, noteSize, noteSize)
  bytes.writeUInt32LE(4, NOTE_OFF)
  bytes.writeUInt32LE(20, NOTE_OFF + 4)
  bytes.writeUInt32LE(3, NOTE_OFF + 8)
  bytes.write("GNU\0", NOTE_OFF + 12, "ascii")
  digest.copy(bytes, NOTE_OFF + 16)
  const dynstrVaddr = LOAD_VADDR + DYNSTR_OFF
  const dyn: Array<[number, number]> = [
    [5, dynstrVaddr],
    [10, dynstr.length],
    [1, strOff("libc.so.6")],
    [14, strOff("libdemo.so.1")],
    [0, 0],
  ]
  dyn.forEach(([tag, val], i) => {
    const o = DYN_OFF + i * 16
    bytes.writeBigInt64LE(BigInt(tag), o)
    bytes.writeBigUInt64LE(BigInt(val), o + 8)
  })
  dynstr.copy(bytes, DYNSTR_OFF)
  const sym = (i: number, name: number, info: number, shndx: number, value: number): void => {
    const o = DYNSYM_OFF + i * 24
    bytes.writeUInt32LE(name, o)
    bytes[o + 4] = info
    bytes[o + 5] = 0
    bytes.writeUInt16LE(shndx, o + 6)
    bytes.writeBigUInt64LE(BigInt(value), o + 8)
    bytes.writeBigUInt64LE(BigInt(0), o + 16)
  }
  sym(0, 0, 0, 0, 0)
  sym(1, strOff("printf"), 0x12, 0, 0)
  sym(2, strOff("main"), 0x12, 1, 0x400100)
  sym(3, strOff("myvar"), 0x11, 1, 0x400200)
  sym(4, strOff("helper"), 0x02, 1, 0x400080)
  shstrtab.copy(bytes, SHSTR_OFF)
  const shdr = (i: number, name: number, type: number, addr: number, off: number, size: number, link: number, info: number, entsize: number): void => {
    const o = SHOFF + i * 64
    bytes.writeUInt32LE(name, o)
    bytes.writeUInt32LE(type, o + 4)
    bytes.writeBigUInt64LE(BigInt(0), o + 8)
    bytes.writeBigUInt64LE(BigInt(addr), o + 16)
    bytes.writeBigUInt64LE(BigInt(off), o + 24)
    bytes.writeBigUInt64LE(BigInt(size), o + 32)
    bytes.writeUInt32LE(link, o + 40)
    bytes.writeUInt32LE(info, o + 44)
    bytes.writeBigUInt64LE(BigInt(1), o + 48)
    bytes.writeBigUInt64LE(BigInt(entsize), o + 56)
  }
  shdr(0, 0, 0, 0, 0, 0, 0, 0, 0)
  shdr(1, 1, 3, dynstrVaddr, DYNSTR_OFF, dynstr.length, 0, 0, 0)
  shdr(2, 9, 11, LOAD_VADDR + DYNSYM_OFF, DYNSYM_OFF, symCount * 24, 1, 1, 24)
  shdr(3, 0, 1, 0, 0, 0, 0, 0, 0)
  shdr(4, 17, 3, 0, SHSTR_OFF, shstrtab.length, 0, 0, 0)
  return { bytes, digestHex: digest.toString("hex") }
}

test("elf64 dynamic section paths", () => {
  const fixture = buildElf()
  const r = analyzeNativeBinary(fixture.bytes)
  expect(r.format).toBe("elf")
  expect(r.architecture).toContain("x86_64")
  expect(r.kind).toBe("executable")
  expect(r.entry).toBe("0x400000")
  expect(r.interpreter).toBe("/lib64/ld-linux-x86-64.so.2")
  expect(r.needed).toEqual(["libc.so.6"])
  expect(r.notes.some((n) => n.includes("gnu-build-id") && n.includes(fixture.digestHex))).toBe(true)
  expect(r.notes.some((n) => n.includes("soname") && n.includes("libdemo.so.1"))).toBe(true)
  expect(r.notes.some((n) => n.includes("stripped"))).toBe(true)
  expect(r.notes.some((n) => n.includes("dwarf"))).toBe(false)
  expect(r.imports).toEqual([{ name: "printf", kind: "func" }])
  expect(r.exports).toContainEqual({ name: "main", kind: "func" })
  expect(r.exports).toContainEqual({ name: "myvar", kind: "object" })
  expect(r.exports.map((e) => e.name).sort()).toEqual(["main", "myvar"])
  const names = [...r.imports.map((s) => s.name), ...r.exports.map((s) => s.name)]
  expect(names).not.toContain("helper")
})
