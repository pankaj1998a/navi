import { test, expect } from "bun:test"
import path from "node:path"
import { analyzeEvmBytecode } from "@/reverse/evm"
import { analyzeFirmware } from "@/reverse/firmware"
import { analyzeNativeBinary } from "@/reverse/native"
import { analyzeApk } from "@/reverse/apk"
import { analyzeManagedAssembly } from "@/reverse/managed"
import { analyzeHar, analyzeSourceMap } from "@/reverse/web"
import { analyzeAppleBundle } from "@/reverse/apple"
import { inventoryAsar } from "@/reverse/asar"
import { analyzeJavascriptApplication } from "@/reverse/javascript"
import { tmpdir } from "../fixture/fixture"

const hex = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

test("evm finds dispatcher selectors", () => {
  const code = hex(`6080604052348015600f57600080fd5b5060808061001e6000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c8063a9059cbb14610037578063dd62ed3e14610059575b600080fd5b61004361006b565b005b61005b610075565b005b600080fd`)
  const r = analyzeEvmBytecode(code, "raw")
  expect(r.selectors).toContain("a9059cbb")
  expect(r.selectors).toContain("dd62ed3e")
  expect(r.payable).toContain("guarded")
})

test("evm rejects bad carriers", () => {
  const r = analyzeEvmBytecode(Buffer.from("0xzz", "utf-8"), "hex")
  expect(r.unknowns.length).toBeGreaterThan(0)
})

test("firmware spots magics", () => {
  const bytes = Buffer.alloc(2048)
  bytes[0] = 0x1f
  bytes[1] = 0x8b
  bytes.write("hsqs", 512)
  bytes.write("admin password=root", 1024, "ascii")
  const r = analyzeFirmware(bytes)
  expect(r.regions.map((x) => x.kind)).toContain("gzip")
  expect(r.regions.map((x) => x.kind)).toContain("squashfs-le")
  expect(r.keywords).toContain("admin")
})

test("native reads a minimal elf64 header", () => {
  const bytes = Buffer.alloc(64)
  bytes.writeUInt32LE(0x464c457f, 0)
  bytes[4] = 2
  bytes[5] = 1
  bytes.writeUInt16LE(2, 16)
  bytes.writeUInt16LE(62, 18)
  bytes.writeBigUInt64LE(BigInt(0x400000), 24)
  const r = analyzeNativeBinary(bytes)
  expect(r.format).toBe("elf")
  expect(r.architecture).toContain("x86_64")
  expect(r.entry).toBe("0x400000")
})

test("native rejects garbage", () => {
  const r = analyzeNativeBinary(Buffer.from("hello world, this is not a binary at all!!"))
  expect(r.format).toBe("unknown")
  expect(r.unknowns.length).toBeGreaterThan(0)
})

test("apk reads an empty zip", () => {
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  const r = analyzeApk(eocd, 100)
  expect(r.entries).toBe(0)
  expect(r.unknowns.length).toBeGreaterThan(0)
})

test("managed rejects non-pe", () => {
  const r = analyzeManagedAssembly(Buffer.alloc(128))
  expect(r.managed).toBe(false)
  expect(r.unknowns.length).toBeGreaterThan(0)
})

test("har summarizes entries", () => {
  const har = JSON.stringify({
    log: {
      version: "1.2",
      entries: [
        { request: { url: "https://a.example/app.js" }, response: { status: 200, content: { mimeType: "application/javascript", bodySize: 100 } } },
        { request: { url: "https://a.example/missing" }, response: { status: 404, content: { mimeType: "text/html", bodySize: 10 } } },
      ],
    },
  })
  const r = analyzeHar(har)
  expect(r.har?.entries).toBe(2)
  expect(r.har?.failures.length).toBe(1)
  expect(r.har?.domains[0]?.name).toBe("a.example")
})

test("sourcemap counts sources", () => {
  const r = analyzeSourceMap(JSON.stringify({ version: 3, sources: ["a.js"], sourcesContent: ["x"], names: [], mappings: "AAAA" }))
  expect(r.sourcemap?.sources).toBe(1)
  expect(r.sourcemap?.sourcesWithContent).toBe(1)
})

test("apple reads an xml plist", async () => {
  await using tmp = await tmpdir()
  const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.app</string><key>CFBundleExecutable</key><string>App</string><key>CFBundleShortVersionString</key><string>2.0</string></dict></plist>`
  await Bun.write(path.join(tmp.path, "Info.plist"), plist)
  const r = analyzeAppleBundle(path.join(tmp.path, "Info.plist"))
  expect(r.plistFormat).toBe("xml")
  expect(r.bundle?.identifier).toBe("com.example.app")
  expect(r.bundle?.shortVersion).toBe("2.0")
})

test("apple reads a binary plist", async () => {
  await using tmp = await tmpdir()
  const head = Buffer.from("bplist00", "ascii")
  const objs = Buffer.from([0xd1, 0x01, 0x02, 0x51, 0x61, 0x51, 0x62])
  const table = Buffer.from([8, 11, 13])
  const trailer = Buffer.alloc(32)
  trailer[6] = 1
  trailer[7] = 1
  trailer.writeBigUInt64BE(BigInt(3), 8)
  trailer.writeBigUInt64BE(BigInt(0), 16)
  trailer.writeBigUInt64BE(BigInt(15), 24)
  await Bun.write(path.join(tmp.path, "b.plist"), Buffer.concat([head, objs, table, trailer]))
  const r = analyzeAppleBundle(path.join(tmp.path, "b.plist"))
  expect(r.plistFormat).toBe("bplist")
})

const buildAsar = (files: Record<string, string>): Buffer => {
  const headerJson = JSON.stringify({
    files: Object.fromEntries(
      Object.entries(files).map(([name, content], i, all) => {
        const offset = all.slice(0, i).reduce((n, [, c]) => n + Buffer.byteLength(c), 0)
        return [name, { size: Buffer.byteLength(content), offset: String(offset) }]
      }),
    ),
  })
  const jsonLen = Buffer.byteLength(headerJson)
  const size = 8 + ((jsonLen + 3) & ~3)
  const header = Buffer.alloc(8 + size)
  header.writeUInt32LE(4, 0)
  header.writeUInt32LE(size, 4)
  header.writeUInt32LE(size - 4, 8)
  header.writeUInt32LE(jsonLen, 12)
  header.write(headerJson, 16)
  return Buffer.concat([header, ...Object.values(files).map((c) => Buffer.from(c))])
}

test("asar inventory round-trips", () => {
  const inv = inventoryAsar(buildAsar({ "index.js": "hello" }))
  expect(inv.entries).toBe(1)
  expect(inv.files[0]?.path).toBe("index.js")
})

test("javascript analyzes an asar", async () => {
  await using tmp = await tmpdir()
  const pkg = JSON.stringify({ name: "demo", main: "index.js" })
  const code = `import { x } from "./lib.js";\nexport const y = 1;\n`
  const archive = path.join(tmp.path, "app.asar")
  await Bun.write(archive, buildAsar({ "package.json": pkg, "index.js": code }))
  const r = analyzeJavascriptApplication(archive, 50)
  expect(r.packageName).toBe("demo")
  expect(r.modules.map((m) => m.path)).toContain("index.js")
})
