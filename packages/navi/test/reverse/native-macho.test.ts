import { test, expect } from "bun:test"
import { analyzeNativeBinary, machoCpu, machoFileType, machoPlatform, machoVersion } from "@/reverse/native"

const segmentCommand = (name: string): Buffer => {
  const cmd = Buffer.alloc(72)
  cmd.writeUInt32LE(0x19, 0)
  cmd.writeUInt32LE(72, 4)
  cmd.write(name, 8, "ascii")
  return cmd
}

const dylibCommand = (path: string, currentVersion: number): Buffer => {
  const name = Buffer.from(`${path}\0`, "utf8")
  const cmd = Buffer.alloc(24 + name.length)
  cmd.writeUInt32LE(0xc, 0)
  cmd.writeUInt32LE(cmd.length, 4)
  cmd.writeUInt32LE(24, 8)
  cmd.writeUInt32LE(0, 12)
  cmd.writeUInt32LE(currentVersion, 16)
  cmd.writeUInt32LE(0, 20)
  name.copy(cmd, 24)
  return cmd
}

const mainCommand = (entryoff: number): Buffer => {
  const cmd = Buffer.alloc(24)
  cmd.writeUInt32LE(0x80000028, 0)
  cmd.writeUInt32LE(24, 4)
  cmd.writeBigUInt64LE(BigInt(entryoff), 8)
  cmd.writeBigUInt64LE(BigInt(0), 16)
  return cmd
}

const uuidCommand = (): Buffer => {
  const cmd = Buffer.alloc(24)
  cmd.writeUInt32LE(0x1b, 0)
  cmd.writeUInt32LE(24, 4)
  for (let i = 0; i < 16; i += 1) cmd[8 + i] = i
  return cmd
}

const buildVersionCommand = (platform: number, minos: number, sdk: number): Buffer => {
  const cmd = Buffer.alloc(24)
  cmd.writeUInt32LE(0x32, 0)
  cmd.writeUInt32LE(24, 4)
  cmd.writeUInt32LE(platform, 8)
  cmd.writeUInt32LE(minos, 12)
  cmd.writeUInt32LE(sdk, 16)
  cmd.writeUInt32LE(0, 20)
  return cmd
}

const buildMacho64 = (cputype: number, commands: Buffer[]): Buffer => {
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(cputype, 4)
  header.writeUInt32LE(0, 8)
  header.writeUInt32LE(2, 12)
  header.writeUInt32LE(commands.length, 16)
  header.writeUInt32LE(commands.reduce((n, c) => n + c.length, 0), 20)
  header.writeUInt32LE(0, 24)
  header.writeUInt32LE(0, 28)
  return Buffer.concat([header, ...commands])
}

const buildFat = (slices: { cputype: number; bytes: Buffer }[]): Buffer => {
  const base = 8 + slices.length * 20
  const offsets: number[] = []
  let cursor = base
  for (const s of slices) {
    offsets.push(cursor)
    cursor += s.bytes.length
  }
  const fat = Buffer.alloc(cursor)
  fat.writeUInt32BE(0xcafebabe, 0)
  fat.writeUInt32BE(slices.length, 4)
  slices.forEach((s, i) => {
    const o = 8 + i * 20
    fat.writeUInt32BE(s.cputype, o)
    fat.writeUInt32BE(0, o + 4)
    fat.writeUInt32BE(offsets[i] ?? 0, o + 8)
    fat.writeUInt32BE(s.bytes.length, o + 12)
    fat.writeUInt32BE(12, o + 16)
    s.bytes.copy(fat, offsets[i])
  })
  return fat
}

const fixtureA = (): Buffer =>
  buildMacho64(0x0100000c, [
    segmentCommand("__TEXT"),
    dylibCommand("/usr/lib/libSystem.B.dylib", 0x00010002),
    mainCommand(0x100),
    uuidCommand(),
    buildVersionCommand(1, 0x000d0000, 0x000e0200),
  ])

test("macho helpers decode cpu, filetype, platform, version", () => {
  expect(machoCpu(0x0100000c)).toBe("arm64")
  expect(machoCpu(0x01000007)).toBe("x86_64")
  expect(machoFileType(2)).toBe("executable")
  expect(machoPlatform(1)).toBe("macOS")
  expect(machoVersion(0x00010002)).toBe("1.0.2")
  expect(machoVersion(0x000d0000)).toBe("13.0.0")
  expect(machoVersion(0x000e0200)).toBe("14.2.0")
})

test("macho reads a synthetic arm64 executable", () => {
  const r = analyzeNativeBinary(fixtureA())
  expect(r.format).toBe("macho")
  expect(r.architecture).toBe("arm64")
  expect(r.kind).toBe("executable")
  expect(r.entry).toBe("0x100")
  expect(r.needed).toEqual(["/usr/lib/libSystem.B.dylib (linked)"])
  expect(r.notes.join("\n")).toContain("uuid 000102030405060708090a0b0c0d0e0f")
  expect(r.notes.join("\n")).toContain("platform macOS min-os 13.0.0 sdk 14.2.0")
  expect(r.notes.join("\n")).toContain("segments: __TEXT")
})

test("macho-fat lists both archs and analyzes the first slice", () => {
  const sliceA = buildMacho64(0x01000007, [segmentCommand("__TEXT")])
  const sliceB = buildMacho64(0x0100000c, [segmentCommand("__TEXT")])
  const fat = buildFat([
    { cputype: 0x01000007, bytes: sliceA },
    { cputype: 0x0100000c, bytes: sliceB },
  ])
  const r = analyzeNativeBinary(fat)
  expect(r.format).toBe("macho-fat")
  expect(r.architecture).toBe("fat (2 archs)")
  expect(r.kind).toBe("executable")
  expect(r.notes.join("\n")).toContain("x86_64@")
  expect(r.notes.join("\n")).toContain("arm64@")
  expect(r.unknowns.map((u) => u.message).join("\n")).toContain("first")
})
