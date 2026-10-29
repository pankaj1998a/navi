import path from "path"
import crypto from "crypto"
import fs from "fs"
import { Global } from "@navi-ai/core/global"
import * as Log from "@navi-ai/core/util/log"
import { protectFilePermissions } from "@/util/file-security"

const log = Log.create({ service: "plugin-trust" })

const filepath = path.join(Global.Path.data, "plugin-trust.json")

type Entry = { spec: string; entry: string; trustedAt: string }
type Registry = Record<string, Entry>

const read = (): Registry => {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8")) as Registry
  } catch {
    return {}
  }
}

const write = (registry: Registry) => {
  try {
    fs.mkdirSync(path.dirname(filepath), { recursive: true })
    fs.writeFileSync(filepath, JSON.stringify(registry, null, 2), { mode: 0o600 })
    protectFilePermissions(filepath)
  } catch (err) {
    log.warn("failed to persist plugin trust registry", { error: String(err) })
  }
}

function fingerprint(entry: string): string | undefined {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(entry)).digest("hex")
  } catch (err) {
    log.warn("failed to fingerprint plugin entry", { entry, error: String(err) })
    return undefined
  }
}

// A plugin's code is trusted iff its entrypoint file (by content hash) was explicitly approved.
// Content hashing means a plugin update always requires re-approval.
export function isTrusted(spec: string, entry: string): boolean {
  const fp = fingerprint(entry)
  if (!fp) return false
  const record = read()[fp]
  return record?.spec === spec && record.entry === entry
}

export function trust(spec: string, entry: string): boolean {
  const fp = fingerprint(entry)
  if (!fp) return false
  const registry = read()
  registry[fp] = { spec, entry, trustedAt: new Date().toISOString() }
  write(registry)
  return true
}

export function forget(spec?: string): void {
  const registry = read()
  let changed = false
  for (const [fp, record] of Object.entries(registry)) {
    if (!spec || record.spec === spec || record.entry === spec) {
      delete registry[fp]
      changed = true
    }
  }
  if (changed) write(registry)
}

export function list(): Entry[] {
  return Object.values(read())
}

export * as PluginTrust from "./trust"
