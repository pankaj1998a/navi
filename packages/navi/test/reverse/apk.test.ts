import { expect, test } from "bun:test"
import { analyzeApk } from "@/reverse/apk"

const STRINGS = [
  "manifest",
  "package",
  "com.example.demo",
  "versionCode",
  "versionName",
  "uses-sdk",
  "minSdkVersion",
  "targetSdkVersion",
  "uses-permission",
  "name",
  "android.permission.INTERNET",
  "application",
  "debuggable",
  "1.0",
]

const idx = (s: string): number => STRINGS.indexOf(s)

const encodePoolString = (s: string): Buffer => {
  const body = Buffer.from(s, "utf8")
  const head = Buffer.from([s.length, body.length])
  return Buffer.concat([head, body, Buffer.from([0x00])])
}

const buildStringPool = (): Buffer => {
  const parts = STRINGS.map(encodePoolString)
  const count = STRINGS.length
  const stringsStart = 28 + count * 4
  const header = Buffer.alloc(28)
  header.writeUInt16LE(0x0001, 0)
  header.writeUInt16LE(28, 2)
  header.writeUInt32LE(0, 4)
  header.writeUInt32LE(count, 8)
  header.writeUInt32LE(0, 12)
  header.writeUInt32LE(0x100, 16)
  header.writeUInt32LE(stringsStart, 20)
  header.writeUInt32LE(0, 24)
  const offsets = Buffer.alloc(count * 4)
  let cursor = 0
  parts.forEach((part, i) => {
    offsets.writeUInt32LE(cursor, i * 4)
    cursor += part.length
  })
  const chunk = Buffer.concat([header, offsets, ...parts])
  chunk.writeUInt32LE(chunk.length, 4)
  return chunk
}

type Attr = { ns: number; name: number; raw: number; type: number; data: number }

const attr = (name: string, raw: number, type: number, data: number): Attr => ({
  ns: -1,
  name: idx(name),
  raw,
  type,
  data,
})

const buildStartElement = (element: string, attrs: Attr[]): Buffer => {
  const fixed = Buffer.alloc(20)
  fixed.writeInt32LE(-1, 0)
  fixed.writeInt32LE(idx(element), 4)
  fixed.writeUInt16LE(20, 8)
  fixed.writeUInt16LE(20, 10)
  fixed.writeUInt16LE(attrs.length, 12)
  fixed.writeUInt16LE(0, 14)
  fixed.writeUInt16LE(0, 16)
  fixed.writeUInt16LE(0, 18)
  const body = Buffer.alloc(attrs.length * 20)
  attrs.forEach((a, i) => {
    const base = i * 20
    body.writeInt32LE(a.ns, base)
    body.writeInt32LE(a.name, base + 4)
    body.writeInt32LE(a.raw, base + 8)
    body.writeUInt16LE(8, base + 12)
    body.writeUInt8(0, base + 14)
    body.writeUInt8(a.type, base + 15)
    body.writeUInt32LE(a.data, base + 16)
  })
  const header = Buffer.alloc(8)
  header.writeUInt16LE(0x0102, 0)
  header.writeUInt16LE(28, 2)
  header.writeUInt32LE(28 + attrs.length * 20, 4)
  return Buffer.concat([header, fixed, body])
}

const buildEndElement = (element: string): Buffer => {
  const chunk = Buffer.alloc(16)
  chunk.writeUInt16LE(0x0103, 0)
  chunk.writeUInt16LE(16, 2)
  chunk.writeUInt32LE(16, 4)
  chunk.writeInt32LE(-1, 8)
  chunk.writeInt32LE(idx(element), 12)
  return chunk
}

const buildManifest = (): Buffer => {
  const pool = buildStringPool()
  const chunks = [
    pool,
    buildStartElement("manifest", [
      attr("package", idx("com.example.demo"), 0x03, idx("com.example.demo")),
      attr("versionCode", -1, 0x10, 42),
      attr("versionName", idx("1.0"), 0x03, idx("1.0")),
    ]),
    buildStartElement("uses-sdk", [attr("minSdkVersion", -1, 0x10, 24), attr("targetSdkVersion", -1, 0x10, 34)]),
    buildEndElement("uses-sdk"),
    buildStartElement("uses-permission", [attr("name", idx("android.permission.INTERNET"), 0x03, idx("android.permission.INTERNET"))]),
    buildEndElement("uses-permission"),
    buildStartElement("application", [attr("debuggable", -1, 0x12, 1)]),
    buildEndElement("application"),
    buildEndElement("manifest"),
  ]
  const header = Buffer.alloc(8)
  header.writeUInt16LE(0x0003, 0)
  header.writeUInt16LE(8, 2)
  header.writeUInt32LE(8 + chunks.reduce((n, c) => n + c.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

const buildDex = (): Buffer => {
  const dex = Buffer.alloc(112)
  dex.write("dex\n035\0", 0, "ascii")
  dex.writeUInt32LE(112, 32)
  dex.writeUInt32LE(0x70, 36)
  dex.writeUInt32LE(0x12345678, 40)
  dex.writeUInt32LE(3, 56)
  dex.writeUInt32LE(2, 64)
  dex.writeUInt32LE(5, 88)
  dex.writeUInt32LE(1, 96)
  return dex
}

const buildZip = (files: { name: string; data: Buffer }[], signingBlock?: Buffer): Buffer => {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  const records: { name: string; data: Buffer; off: number }[] = []
  let cursor = 0
  for (const f of files) {
    const nameBytes = Buffer.from(f.name, "utf8")
    records.push({ name: f.name, data: f.data, off: cursor })
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(f.data.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, f.data)
    cursor += local.length + nameBytes.length + f.data.length
  }
  const block = signingBlock ?? Buffer.alloc(0)
  const dirOff = cursor + block.length
  for (const r of records) {
    const nameBytes = Buffer.from(r.name, "utf8")
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(0, 16)
    central.writeUInt32LE(r.data.length, 20)
    central.writeUInt32LE(r.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(r.off, 42)
    centrals.push(central, nameBytes)
  }
  const dir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(dir.length, 12)
  eocd.writeUInt32LE(dirOff, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, block, dir, eocd])
}

const buildSigningBlock = (): Buffer => {
  const value = Buffer.from([1, 2, 3, 4])
  const pairSize = 4 + value.length
  const pair = Buffer.alloc(8 + pairSize)
  pair.writeBigUInt64LE(BigInt(pairSize), 0)
  pair.writeUInt32LE(0x7109871a, 8)
  value.copy(pair, 12)
  const total = pair.length
  const head = Buffer.alloc(8)
  head.writeBigUInt64LE(BigInt(total), 0)
  const tail = Buffer.alloc(8)
  tail.writeBigUInt64LE(BigInt(total), 0)
  return Buffer.concat([head, pair, tail, Buffer.from("APK Sig Block 42", "ascii")])
}

const buildApk = (withSigning: boolean): Buffer =>
  buildZip(
    [
      { name: "AndroidManifest.xml", data: buildManifest() },
      { name: "classes.dex", data: buildDex() },
      { name: "META-INF/CERT.SF", data: Buffer.from("dummy", "utf8") },
    ],
    withSigning ? buildSigningBlock() : undefined,
  )

test("apk analyzes synthetic stored zip", () => {
  const r = analyzeApk(buildApk(false), 100)
  expect(r.entries).toBe(3)
  expect(r.manifest?.package).toBe("com.example.demo")
  expect(r.manifest?.versionCode).toBe("42")
  expect(r.manifest?.versionName).toBe("1.0")
  expect(r.manifest?.minSdk).toBe("24")
  expect(r.manifest?.targetSdk).toBe("34")
  expect(r.manifest?.permissions).toEqual(["android.permission.INTERNET"])
  expect(r.manifest?.debuggable).toBe(true)
  expect(r.dex[0]?.strings).toBe(3)
  expect(r.dex[0]?.types).toBe(2)
  expect(r.dex[0]?.methods).toBe(5)
  expect(r.dex[0]?.classes).toBe(1)
  expect(r.signatures).toContain("v1 (JAR)")
})

test("apk detects v2 signing block", () => {
  const r = analyzeApk(buildApk(true), 100)
  expect(r.entries).toBe(3)
  expect(r.signatures).toContain("v1 (JAR)")
  expect(r.signatures).toContain("v2")
  expect(r.manifest?.package).toBe("com.example.demo")
  expect(r.dex[0]?.methods).toBe(5)
})
