import path from "path"
import fs from "fs/promises"
import * as Log from "@navi-ai/core/util/log"
import * as Process from "./process"

const log = Log.create({ service: "archive" })

function assertSafeDestination(zipPath: string, destDir: string): { zip: string; dest: string } {
  const zip = path.resolve(zipPath)
  const dest = path.resolve(destDir)
  const root = path.parse(dest).root
  if (dest === root || dest.length <= root.length + 1) {
    log.error("refusing zip extraction to filesystem root", { dest })
    throw new Error(`Unsafe zip destination: ${dest}`)
  }
  return { zip, dest }
}

async function assertZipEntriesSafe(zip: string, dest: string): Promise<void> {
  try {
    const listed = await Process.run(["tar", "-tf", zip], { nothrow: true })
    if (listed.code !== 0) return
    const entries = listed.stdout.toString("utf8").split(/\r?\n/).filter(Boolean)
    for (const entry of entries) {
      const normalized = path.normalize(path.join(dest, entry))
      if (normalized !== dest && !normalized.startsWith(dest + path.sep)) {
        log.error("blocked Zip-Slip entry", { entry })
        throw new Error(`Blocked Zip-Slip entry: ${entry}`)
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Blocked Zip-Slip")) throw e
    log.warn("could not list zip entries, proceeding with caution", { zip, error: String(e) })
  }
}

async function assertNoEscape(dest: string, before: Set<string>): Promise<void> {
  const walk = async (dir: string): Promise<string[]> => {
    const out: string[] = []
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const normalized = path.normalize(full)
      if (normalized !== dest && !normalized.startsWith(dest + path.sep)) {
        log.error("blocked Zip-Slip escape", { full })
        throw new Error(`Zip extraction escaped destination: ${full}`)
      }
      out.push(full)
      if (entry.isDirectory()) out.push(...(await walk(full)))
    }
    return out
  }
  const after = await walk(dest)
  for (const file of after) {
    if (!before.has(file)) {
      const normalized = path.normalize(file)
      if (normalized !== dest && !normalized.startsWith(dest + path.sep)) {
        log.error("blocked Zip-Slip escape", { file })
        throw new Error(`Zip extraction escaped destination: ${file}`)
      }
    }
  }
}

async function snapshot(dest: string): Promise<Set<string>> {
  const out = new Set<string>()
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      out.add(full)
      if (entry.isDirectory()) await walk(full)
    }
  }
  await fs.mkdir(dest, { recursive: true })
  await walk(dest)
  return out
}

export async function extractZip(zipPath: string, destDir: string) {
  const { zip, dest } = assertSafeDestination(zipPath, destDir)
  await assertZipEntriesSafe(zip, dest)
  const before = await snapshot(dest)
  if (process.platform === "win32") {
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    // -LiteralPath + quote-escaping prevents wildcard/injection via crafted paths
    const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${zip.replaceAll("'", "''")}' -DestinationPath '${dest.replaceAll("'", "''")}' -Force`
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
    await assertNoEscape(dest, before)
    return
  }

  await Process.run(["unzip", "-o", "-q", zip, "-d", dest])
  await assertNoEscape(dest, before)
}

export * as Archive from "./archive"
