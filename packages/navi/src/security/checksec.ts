import fs from "node:fs"
import path from "node:path"

export interface BinaryMitigations {
  file: string
  format: "pe" | "elf" | "macho" | "unknown"
  architecture: string
  bits: number
  nx: boolean // Data Execution Prevention / No-Execute
  pie: boolean // Position Independent Executable / ASLR
  canary: boolean // Stack Canaries / Stack Cookies
  relro?: "full" | "partial" | "none" // ELF Relocation Read-Only
  safeSeh?: boolean // Windows Safe Structured Exception Handling
  controlFlowGuard?: boolean // Windows Control Flow Guard (CFG)
  signed?: boolean // Authenticode / Code signature present
  notes: string[]
  securityScore: number // 0 - 100
}

function readU16LE(buf: Buffer, off: number): number {
  if (off + 2 > buf.length) return 0
  return buf.readUInt16LE(off)
}

function readU32LE(buf: Buffer, off: number): number {
  if (off + 4 > buf.length) return 0
  return buf.readUInt32LE(off)
}

function readU32BE(buf: Buffer, off: number): number {
  if (off + 4 > buf.length) return 0
  return buf.readUInt32BE(off)
}

function auditPe(buf: Buffer, filePath: string): BinaryMitigations {
  const notes: string[] = []
  let score = 20

  const peOff = readU32LE(buf, 0x3c)
  const coff = peOff + 4
  const machine = readU16LE(buf, coff)
  const arch = machine === 0x8664 ? "x86_64" : machine === 0x014c ? "x86" : machine === 0xaa64 ? "arm64" : "unknown"
  const bits = machine === 0x8664 || machine === 0xaa64 ? 64 : 32

  const optHeader = coff + 20
  const dllCharacteristics = readU16LE(buf, optHeader + 70)

  // IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE = 0x0040 (ASLR)
  const aslr = (dllCharacteristics & 0x0040) !== 0
  // IMAGE_DLLCHARACTERISTICS_NX_COMPAT = 0x0100 (DEP / NX)
  const dep = (dllCharacteristics & 0x0100) !== 0
  // IMAGE_DLLCHARACTERISTICS_GUARD_CF = 0x4000 (Control Flow Guard)
  const cfg = (dllCharacteristics & 0x4000) !== 0
  // IMAGE_DLLCHARACTERISTICS_HIGH_ENTROPY_VA = 0x0020
  const highEntropyVA = (dllCharacteristics & 0x0020) !== 0

  if (aslr) {
    score += 25
    notes.push(highEntropyVA ? "ASLR enabled with High-Entropy 64-bit VA" : "ASLR (Dynamic Base) enabled")
  } else {
    notes.push("WARNING: ASLR disabled (fixed base address allows predictable ROP)")
  }

  if (dep) {
    score += 25
    notes.push("DEP/NX enabled (stack & heap pages marked non-executable)")
  } else {
    notes.push("CRITICAL: DEP/NX disabled (executable stack/heap enables shellcode)")
  }

  if (cfg) {
    score += 15
    notes.push("Control Flow Guard (CFG) enabled (mitigates indirect call hijacking)")
  }

  // Check for Security Cookie /GS in string references
  const hasCanary = buf.includes(Buffer.from("__security_check_cookie")) || buf.includes(Buffer.from("__security_cookie"))
  if (hasCanary) {
    score += 15
    notes.push("Stack Cookies (/GS canary) present")
  } else {
    notes.push("Stack Cookie (/GS) not detected")
  }

  // Check Authenticode Signature (Security Directory entry at optHeader + 128 + (bits == 64 ? 16 : 0))
  const secDirOffset = optHeader + (bits === 64 ? 144 : 128)
  const secDirRva = readU32LE(buf, secDirOffset)
  const signed = secDirRva > 0
  if (signed) {
    score = Math.min(100, score + 10)
    notes.push("Authenticode Digital Signature table present")
  }

  return {
    file: filePath,
    format: "pe",
    architecture: arch,
    bits,
    nx: dep,
    pie: aslr,
    canary: hasCanary,
    controlFlowGuard: cfg,
    signed,
    notes,
    securityScore: score,
  }
}

function auditElf(buf: Buffer, filePath: string): BinaryMitigations {
  const notes: string[] = []
  let score = 20

  const is64 = buf[4] === 2
  const bits = is64 ? 64 : 32
  const isLe = buf[5] === 1

  const elfType = isLe ? readU16LE(buf, 16) : buf.readUInt16BE(16)
  const machine = isLe ? readU16LE(buf, 18) : buf.readUInt16BE(18)
  const arch = machine === 62 ? "x86_64" : machine === 3 ? "x86" : machine === 183 ? "aarch64" : "unknown"

  // PIE: ET_DYN (3) typically means PIE/shared object
  const isPie = elfType === 3
  if (isPie) {
    score += 25
    notes.push("PIE (Position Independent Executable / ASLR) enabled")
  } else {
    notes.push("WARNING: No PIE (fixed virtual memory layout enables ROP)")
  }

  // NX: Check GNU_STACK program header for executable flag (PF_X = 1)
  // By default in modern toolchains GNU_STACK is present with RW flags (no X)
  const hasGnuStack = buf.includes(Buffer.from(".note.GNU-stack")) || buf.includes(Buffer.from("GNU_STACK"))
  const nx = hasGnuStack || !buf.includes(Buffer.from("execstack"))
  if (nx) {
    score += 25
    notes.push("NX enabled (GNU_STACK non-executable)")
  } else {
    notes.push("CRITICAL: NX disabled (executable stack enables shellcode)")
  }

  // Canary check: __stack_chk_fail symbol
  const hasCanary = buf.includes(Buffer.from("__stack_chk_fail"))
  if (hasCanary) {
    score += 20
    notes.push("Stack Canaries enabled (__stack_chk_fail symbol found)")
  } else {
    notes.push("Stack Canaries not detected")
  }

  // RELRO: check for BIND_NOW and GNU_RELRO
  const hasRelro = buf.includes(Buffer.from("GNU_RELRO"))
  const hasBindNow = buf.includes(Buffer.from("BIND_NOW"))
  let relro: "full" | "partial" | "none" = "none"
  if (hasRelro && hasBindNow) {
    relro = "full"
    score += 20
    notes.push("Full RELRO (GOT table is completely read-only)")
  } else if (hasRelro) {
    relro = "partial"
    score += 10
    notes.push("Partial RELRO (GOT table partially protected)")
  } else {
    notes.push("No RELRO (GOT table vulnerable to overwrite)")
  }

  return {
    file: filePath,
    format: "elf",
    architecture: arch,
    bits,
    nx,
    pie: isPie,
    canary: hasCanary,
    relro,
    notes,
    securityScore: score,
  }
}

function auditMacho(buf: Buffer, filePath: string): BinaryMitigations {
  const notes: string[] = []
  let score = 30

  const magic = readU32BE(buf, 0)
  const is64 = magic === 0xfeedfacf || magic === 0xcffaedfe
  const isFat = magic === 0xcafebabe || magic === 0xbebafeca
  const isLe = magic === 0xcefaedfe || magic === 0xcffaedfe

  if (isFat) {
    return {
      file: filePath,
      format: "macho",
      architecture: "universal",
      bits: 64,
      nx: true,
      pie: true,
      canary: true,
      notes: ["Universal/Fat Mach-O binary with multiple architecture slices"],
      securityScore: 85,
    }
  }

  const cputype = isLe ? readU32LE(buf, 4) : readU32BE(buf, 4)
  const arch = cputype === 0x01000007 ? "x86_64" : cputype === 0x0100000c ? "arm64" : "x86"

  // Mach-O MH_PIE flag = 0x00200000 at offset 20 (flags)
  const flags = isLe ? readU32LE(buf, 20) : readU32BE(buf, 20)
  const pie = (flags & 0x00200000) !== 0
  if (pie) {
    score += 25
    notes.push("PIE (Position Independent Executable) enabled")
  } else {
    notes.push("PIE disabled")
  }

  // NX is enforced by default on macOS 64-bit
  const nx = true
  score += 25
  notes.push("NX (DEP) enforced by Darwin kernel for 64-bit binaries")

  const hasCanary = buf.includes(Buffer.from("___stack_chk_fail")) || buf.includes(Buffer.from("___stack_chk_guard"))
  if (hasCanary) {
    score += 20
    notes.push("Stack Canaries enabled (___stack_chk_fail present)")
  }

  const hasCodeSign = buf.includes(Buffer.from("LC_CODE_SIGNATURE")) || buf.includes(Buffer.from("CodeResources"))
  if (hasCodeSign) {
    score = Math.min(100, score + 10)
    notes.push("Code Signature (LC_CODE_SIGNATURE) present")
  }

  return {
    file: filePath,
    format: "macho",
    architecture: arch,
    bits: is64 ? 64 : 32,
    nx,
    pie,
    canary: hasCanary,
    signed: hasCodeSign,
    notes,
    securityScore: score,
  }
}

export function checksecBinary(filePath: string): BinaryMitigations {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`)
  }

  const buf = fs.readFileSync(resolved)
  if (buf.length < 64) {
    throw new Error(`File too small to be an executable: ${resolved}`)
  }

  // Check PE
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    return auditPe(buf, filePath)
  }

  // Check ELF
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return auditElf(buf, filePath)
  }

  // Check Mach-O
  const magic = readU32BE(buf, 0)
  if (
    magic === 0xfeedface ||
    magic === 0xfeedfacf ||
    magic === 0xcefaedfe ||
    magic === 0xcffaedfe ||
    magic === 0xcafebabe ||
    magic === 0xbebafeca
  ) {
    return auditMacho(buf, filePath)
  }

  return {
    file: filePath,
    format: "unknown",
    architecture: "unknown",
    bits: 0,
    nx: false,
    pie: false,
    canary: false,
    notes: ["File format does not match PE, ELF, or Mach-O executable signatures."],
    securityScore: 0,
  }
}
