import { test, expect } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { analyzeManagedAssembly } from "@/reverse/managed"

const nativePe = (): Buffer => {
  const bytes = Buffer.alloc(512)
  bytes[0] = 0x4d
  bytes[1] = 0x5a
  bytes.writeUInt32LE(0x40, 0x3c)
  bytes.writeUInt32LE(0x00004550, 0x40)
  bytes.writeUInt16LE(0x014c, 0x44)
  bytes.writeUInt16LE(1, 0x46)
  bytes.writeUInt16LE(224, 0x54)
  bytes.writeUInt16LE(0x010f, 0x56)
  bytes.writeUInt16LE(0x010b, 0x58)
  bytes.writeUInt32LE(16, 0xb4)
  return bytes
}

test("managed rejects non-pe bytes", () => {
  const r = analyzeManagedAssembly(Buffer.from("not a pe file"))
  expect(r.managed).toBe(false)
  expect(r.tables).toEqual([])
  expect(r.unknowns.length).toBeGreaterThan(0)
})

test("managed detects native pe without cli", () => {
  const r = analyzeManagedAssembly(nativePe())
  expect(r.managed).toBe(false)
  expect(r.layout.architecture).toBe("x86")
  expect(r.unknowns.length).toBeGreaterThan(0)
})

test("managed reads mscorlib identity when present", () => {
  const p = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\mscorlib.dll"
  if (!existsSync(p)) return
  const r = analyzeManagedAssembly(readFileSync(p))
  expect(r.managed).toBe(true)
  expect(r.assembly?.name).toBe("mscorlib")
  expect(r.assembly?.version).toBe("4.0.0.0")
  expect(r.assembly?.culture).toBe("neutral")
  expect(r.assembly?.runtimeVersion).toBe("v4.0.30319")
  expect(r.tables.find((t) => t.table === "MethodDef")?.rows).toBe(29257)
})
