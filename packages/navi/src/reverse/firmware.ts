import { Schema } from "effect"
import { unknown, type Unknown } from "./evidence"

export const FirmwareRegion = Schema.Struct({
  offset: Schema.Number,
  kind: Schema.String,
  detail: Schema.String,
})

export type FirmwareRegion = Schema.Schema.Type<typeof FirmwareRegion>

export const FirmwareAnalysis = Schema.Struct({
  size: Schema.Number,
  regions: Schema.Array(FirmwareRegion),
  strings: Schema.Number,
  keywords: Schema.Array(Schema.String),
  entropyMean: Schema.Number,
  entropyHotspots: Schema.Array(Schema.Number),
  unknowns: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      message: Schema.String,
      path: Schema.optional(Schema.String),
    }),
  ),
})

export type FirmwareAnalysis = Schema.Schema.Type<typeof FirmwareAnalysis>

type Magic = { kind: string; detail: string; at: number; bytes: number[] }

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0))

const MAGICS: { kind: string; detail: string; bytes: number[]; mask?: number[] }[] = [
  { kind: "uImage", detail: "U-Boot legacy image", bytes: [0x27, 0x05, 0x19, 0x56] },
  { kind: "TRX", detail: "Broadcom TRX firmware", bytes: ascii("HDR0") },
  { kind: "squashfs-le", detail: "SquashFS little-endian", bytes: ascii("hsqs") },
  { kind: "squashfs-be", detail: "SquashFS big-endian", bytes: ascii("sqsh") },
  { kind: "squashfs-le-v2", detail: "SquashFS LE variant", bytes: ascii("shsq") },
  { kind: "squashfs-be-v2", detail: "SquashFS BE variant", bytes: ascii("qshs") },
  { kind: "cramfs", detail: "Compressed ROMFS", bytes: ascii("Compr") },
  { kind: "jffs2-le", detail: "JFFS2 little-endian", bytes: [0x85, 0x19, 0x03, 0x20] },
  { kind: "jffs2-be", detail: "JFFS2 big-endian", bytes: [0x20, 0x03, 0x19, 0x85] },
  { kind: "gzip", detail: "gzip member", bytes: [0x1f, 0x8b] },
  { kind: "xz", detail: "xz container", bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] },
  { kind: "lzma-alone", detail: "LZMA alone stream", bytes: [0x5d, 0x00, 0x00] },
  { kind: "zip", detail: "zip archive", bytes: ascii("PK\x03\x04") },
  { kind: "7zip", detail: "7-Zip archive", bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { kind: "dtb", detail: "Flattened device tree / FIT", bytes: [0xd0, 0x0d, 0xfe, 0xed] },
  { kind: "android-boot", detail: "Android boot image", bytes: ascii("ANDROID!") },
  { kind: "rockchip", detail: "Rockchip firmware", bytes: ascii("RKFW") },
  { kind: "ext", detail: "ext2/3/4 superblock", bytes: [0x53, 0xef] },
  { kind: "elf", detail: "ELF object", bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { kind: "pe", detail: "PE executable", bytes: ascii("MZ") },
]

const KEYWORDS = ["passwd", "shadow", "admin", "backdoor", "telnetd", "dropbear", "BEGIN PRIVATE KEY", "BEGIN RSA", "default_password", "debug"]

const isPrintable = (b: number): boolean => b >= 0x20 && b <= 0x7e

const scanMagics = (bytes: Buffer): Magic[] => {
  const found: Magic[] = []
  const stride = 512
  for (let at = 0; at + 8 <= bytes.length; at += stride) {
    for (const m of MAGICS) {
      if (m.kind === "ext") continue
      let ok = true
      for (let k = 0; k < m.bytes.length; k += 1) {
        if (bytes[at + k] !== m.bytes[k]) {
          ok = false
          break
        }
      }
      if (ok) found.push({ kind: m.kind, detail: m.detail, at, bytes: m.bytes })
    }
  }
  if (bytes.length >= 1080 + 2 && bytes[1080] === 0x53 && bytes[1081] === 0xef) {
    found.push({ kind: "ext", detail: "ext2/3/4 superblock", at: 1080, bytes: [0x53, 0xef] })
  }
  return found.toSorted((a, b) => a.at - b.at)
}

const extractStrings = (bytes: Buffer, cap: number): { count: number; keywords: string[] } => {
  let count = 0
  let run = 0
  let start = 0
  const texts: string[] = []
  for (let i = 0; i <= bytes.length; i += 1) {
    const b = i < bytes.length ? (bytes[i] ?? 0) : 0
    if (isPrintable(b) || b === 0x09) {
      if (run === 0) start = i
      run += 1
    } else {
      if (run >= 5 && texts.length < 40) texts.push(bytes.toString("ascii", start, i))
      if (run >= 5) count += 1
      run = 0
      if (count >= cap) break
    }
  }
  const joined = texts.join("\n").toLowerCase()
  return { count, keywords: KEYWORDS.filter((k) => joined.includes(k.toLowerCase())) }
}

const shannon = (bytes: Buffer, off: number, len: number): number => {
  const bins = Array.from({ length: 256 }, () => 0)
  for (let i = 0; i < len; i += 1) {
    const b = bytes[off + i] ?? 0
    bins[b] = (bins[b] ?? 0) + 1
  }
  let entropy = 0
  for (const c of bins) {
    if (c === 0) continue
    const p = c / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

export const analyzeFirmware = (bytes: Buffer): FirmwareAnalysis => {
  const unknowns: Unknown[] = []
  const regions: FirmwareRegion[] = scanMagics(bytes).slice(0, 64).map((m) => {
    let detail = m.detail
    if (m.kind === "uImage" && m.at + 64 <= bytes.length) {
      detail = `U-Boot legacy image (${bytes.toString("ascii", m.at + 32, m.at + 64).replaceAll("\0", "").trim() || "unnamed"})`
    }
    return { offset: m.at, kind: m.kind, detail }
  })
  if (regions.length === 0)
    unknowns.push(unknown("inference", "No known firmware magic; raw blob, encrypted image, or unsupported container."))
  const { count, keywords } = extractStrings(bytes, 200000)
  const window = 4096
  const scores: { off: number; e: number }[] = []
  let sum = 0
  let n = 0
  for (let off = 0; off + window <= bytes.length; off += window) {
    const e = shannon(bytes, off, window)
    sum += e
    n += 1
    scores.push({ off, e })
  }
  scores.sort((a, b) => b.e - a.e)
  const hotspots = scores.slice(0, 6).map((s) => s.off)
  if (scores.length > 0 && (scores[0]?.e ?? 0) > 7.5)
    unknowns.push(unknown("inference", "High-entropy regions present; compressed or encrypted segments likely, extraction needs binwalk/unblob (see reverse_doctor)."))
  return {
    size: bytes.length,
    regions,
    strings: count,
    keywords,
    entropyMean: n === 0 ? 0 : Math.round((sum / n) * 100) / 100,
    entropyHotspots: hotspots,
    unknowns,
  }
}

export * as ReverseFirmware from "./firmware"
