import fs from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import { sha256Hex } from "./digests"
import { unknown, type EvidenceBundle, type ObservedModule, type Unknown } from "./evidence"
import { inventoryAsar, readAsarEntry } from "./asar"

const JS_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".json"])

const isJsPath = (rel: string): boolean => JS_EXTS.has(path.extname(rel).toLowerCase())

const buildBundle = (
  root: string,
  items: { rel: string; content: string }[],
  pkg: { packageName?: string; electronMain?: string },
  extra: Unknown[],
  truncated: boolean,
): EvidenceBundle & { truncated: boolean } => {
  const unknowns: Unknown[] = [...extra]
  if (truncated) unknowns.push(unknown("capacity", "File cap reached; results are partial."))
  const modules: ObservedModule[] = items.map((item) => {
    const parsed = parseImportsExports(item.content)
    return {
      path: item.rel,
      digest: sha256Hex(item.content),
      imports: parsed.imports,
      exports: parsed.exports,
      lines: item.content.split("\n").length,
    }
  })
  if (pkg.packageName === undefined && modules.length > 0) {
    unknowns.push(unknown("inference", "No package.json found; Electron boundaries unavailable, module graph is observed-only."))
  }
  return {
    root,
    modules,
    unknowns,
    ...(pkg.packageName !== undefined ? { packageName: pkg.packageName } : {}),
    ...(pkg.electronMain !== undefined ? { electronMain: pkg.electronMain } : {}),
    truncated,
  }
}

const analyzeAsarBundle = (archive: string, maxFiles: number): EvidenceBundle & { truncated: boolean } => {
  const bytes = fs.readFileSync(archive)
  const inv = inventoryAsar(bytes)
  if (inv.entries === 0) {
    return {
      root: archive,
      modules: [],
      unknowns: inv.unknowns,
      truncated: false,
    }
  }
  const candidates = inv.files.filter((f) => !f.unpacked && f.size > 0 && f.size <= 4 * 1024 * 1024 && isJsPath(f.path))
  const truncated = candidates.length > maxFiles
  const items: { rel: string; content: string }[] = []
  const extra: Unknown[] = [...inv.unknowns]
  let bytesRead = 0
  for (const entry of candidates.slice(0, maxFiles)) {
    if (bytesRead > 16 * 1024 * 1024) {
      extra.push(unknown("capacity", "ASAR byte budget reached; remaining entries skipped."))
      break
    }
    const data = readAsarEntry(bytes, inv, entry)
    if (!data) continue
    bytesRead += data.length
    items.push({ rel: entry.path, content: data.toString("utf8") })
  }
  const skippedUnpacked = inv.files.filter((f) => f.unpacked).length
  if (skippedUnpacked > 0) extra.push(unknown("omission", `${skippedUnpacked} unpacked entries live beside the archive and were not read.`))
  const pkgEntry = items.find((i) => i.rel === "package.json" || i.rel.endsWith("/package.json"))
  let pkg: { packageName?: string; electronMain?: string } = {}
  if (pkgEntry) {
    const info = readPackageInfoFromText(pkgEntry.content)
    pkg = { ...(info.packageName ? { packageName: info.packageName } : {}), ...(info.electronMain ? { electronMain: info.electronMain } : {}) }
    if (info.unknown) extra.push(info.unknown)
  }
  return buildBundle(archive, items, pkg, extra, truncated)
}
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".cache", "coverage"])

const importRe =
  /(?:import\s+(?:[\w*\s{},]+\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\))/g
const exportRe = /export\s+(?:default\s+)?(?:const|let|var|function|class|async\s+function)?\s*([\w$]+)?/g
const exportFromRe = /export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g

export const parseImportsExports = (content: string): { imports: string[]; exports: string[] } => {
  const imports = new Set<string>()
  const exports = new Set<string>()
  importRe.lastIndex = 0
  for (let m = importRe.exec(content); m !== null; m = importRe.exec(content)) {
    const target = m[1] ?? m[2] ?? m[3]
    if (target) imports.add(target)
  }
  exportRe.lastIndex = 0
  for (let m = exportRe.exec(content); m !== null; m = exportRe.exec(content)) {
    if (m[1]) exports.add(m[1])
  }
  exportFromRe.lastIndex = 0
  for (let m = exportFromRe.exec(content); m !== null; m = exportFromRe.exec(content)) {
    if (m[1]) imports.add(m[1])
  }
  return { imports: [...imports].toSorted(), exports: [...exports].toSorted() }
}

export const listJsFiles = (root: string, maxFiles: number): { files: string[]; truncated: boolean } => {
  const files: string[] = []
  const walk = (dir: string): boolean => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (files.length >= maxFiles) return false
      if (entry.name.startsWith(".")) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        if (!walk(full)) return false
      } else if (entry.isFile() && JS_EXTS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full)
      }
    }
    return true
  }
  const complete = walk(root)
  return { files: files.toSorted(), truncated: !complete }
}

const PackageJson = Schema.Struct({
  name: Schema.optional(Schema.String),
  main: Schema.optional(Schema.String),
})

export const readPackageInfo = (
  root: string,
): { packageName: string | undefined; electronMain: string | undefined; unknown: Unknown | undefined } => {
  const pkgPath = path.join(root, "package.json")
  if (!fs.existsSync(pkgPath)) return { packageName: undefined, electronMain: undefined, unknown: undefined }
  return readPackageInfoFromText(fs.readFileSync(pkgPath, "utf-8"))
}

export const readPackageInfoFromText = (
  raw: string,
): { packageName: string | undefined; electronMain: string | undefined; unknown: Unknown | undefined } => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { packageName: undefined, electronMain: undefined, unknown: unknown("malformed", "package.json failed to parse; package boundaries unavailable.") }
  }
  if (!Schema.is(PackageJson)(parsed)) {
    return { packageName: undefined, electronMain: undefined, unknown: unknown("malformed", "package.json has no usable name/main fields.") }
  }
  return { packageName: parsed.name, electronMain: parsed.main, unknown: undefined }
}

export const analyzeJavascriptApplication = (
  root: string,
  maxFiles: number,
): EvidenceBundle & { truncated: boolean } => {
  if (root.endsWith(".asar")) return analyzeAsarBundle(root, maxFiles)
  const stat = fs.statSync(root)
  const dir = stat.isDirectory() ? root : path.dirname(root)
  const single = stat.isFile() && isJsPath(root)
  if (single) {
    const content = fs.readFileSync(root, "utf-8")
    const pkg = readPackageInfo(dir)
    const extra = pkg.unknown ? [pkg.unknown] : []
    return buildBundle(dir, [{ rel: path.basename(root), content }], pkg, extra, false)
  }
  const { files, truncated } = listJsFiles(dir, maxFiles)
  const items = files.map((file) => ({
    rel: path.relative(dir, file).replace(/\\/g, "/"),
    content: fs.readFileSync(file, "utf-8"),
  }))
  const pkg = readPackageInfo(dir)
  const extra = pkg.unknown ? [pkg.unknown] : []
  return buildBundle(dir, items, pkg, extra, truncated)
}

export * as ReverseJavascript from "./javascript"
