import fs from "fs/promises"
import type { Dirent } from "fs"
import path from "path"

export type RepoHealthSeverity = "info" | "warn" | "error"

export type RepoHealthIssue = {
  id: string
  severity: RepoHealthSeverity
  title: string
  detail?: string
  files?: string[]
}

export type RepoHealthReport = {
  root: string
  scannedAt: string
  summary: {
    errors: number
    warnings: number
    infos: number
  }
  issues: RepoHealthIssue[]
}

const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".d.ts"]
const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".navi",
  ".planning",
  ".vibemode",
  "navi-portable",
  "coverage",
  ".next",
  ".cache",
])

export async function scanRepoHealth(root: string): Promise<RepoHealthReport> {
  const scanRoot = await resolveScanRoot(root)
  const srcRoot = path.join(scanRoot, "src")
  const promptRoot = path.join(srcRoot, "agent", "prompt")
  const defaultsRoot = path.join(srcRoot, "agent", "defaults")
  const agentFile = path.join(srcRoot, "agent", "agent.ts")
  const toolTaskFile = path.join(srcRoot, "tool", "task.txt")

  const [sourceFiles, testFiles, promptFiles, defaultsFiles] = await Promise.all([
    listFiles(srcRoot, isSourceFile),
    listFiles(scanRoot, isTestFile),
    listFiles(promptRoot, (file) => file.endsWith(".txt")),
    listFiles(defaultsRoot, (file) => file.endsWith(".md")),
  ])

  const issues: RepoHealthIssue[] = []
  const existsCache = new Map<string, boolean>()

  const brokenImports = await findBrokenRelativeImports(sourceFiles, testFiles, existsCache)
  for (const item of brokenImports) {
    issues.push({
      id: "broken-relative-import",
      severity: "error",
      title: "Broken relative import",
      detail: `${item.file} -> ${item.spec}`,
      files: [item.file],
    })
  }

  const staleTests = findStaleTests(sourceFiles, testFiles)
  for (const file of staleTests) {
    issues.push({
      id: "stale-test",
      severity: "warn",
      title: "Test file has no matching source module",
      detail: file,
      files: [file],
    })
  }

  const promptDrift = await findPromptAgentDrift(agentFile, promptFiles, sourceFiles)
  issues.push(...promptDrift)

  const subagentDrift = await findSubagentReferences(agentFile, [...promptFiles, ...defaultsFiles, toolTaskFile])
  issues.push(...subagentDrift)

  const summary = {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warn").length,
    infos: issues.filter((i) => i.severity === "info").length,
  }

  return {
    root: scanRoot,
    scannedAt: new Date().toISOString(),
    summary,
    issues: issues.sort((a, b) => {
      const order: Record<RepoHealthSeverity, number> = { error: 0, warn: 1, info: 2 }
      const delta = order[a.severity] - order[b.severity]
      if (delta !== 0) return delta
      return a.title.localeCompare(b.title)
    }),
  }
}

async function resolveScanRoot(root: string) {
  const candidate = path.join(root, "packages", "navi", "src")
  if (await existsDir(candidate)) return path.join(root, "packages", "navi")
  const direct = path.join(root, "src")
  if (await existsDir(direct)) return root
  return root
}

async function listFiles(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  const results: string[] = []
  await walk(root, results, predicate)
  return results.sort((a, b) => a.localeCompare(b))
}

async function walk(dir: string, results: string[], predicate: (file: string) => boolean) {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue
      await walk(path.join(dir, entry.name), results, predicate)
      continue
    }
    if (!entry.isFile()) continue
    const full = path.join(dir, entry.name)
    if (predicate(full)) results.push(full)
  }
}

function isSourceFile(file: string) {
  return SOURCE_EXTS.includes(path.extname(file))
}

function isTestFile(file: string) {
  const name = path.basename(file).toLowerCase()
  if (name.includes(".test.") || name.includes(".spec.")) return true
  const normalized = file.toLowerCase().replace(/\\/g, "/")
  return normalized.includes("/test/") || normalized.includes("/tests/") || normalized.includes("/__tests__/")
}

async function findBrokenRelativeImports(
  sourceFiles: string[],
  testFiles: string[],
  existsCache: Map<string, boolean>,
) {
  const files = [...new Set([...sourceFiles, ...testFiles])]
  const missing: { file: string; spec: string }[] = []
  for (const file of files) {
    let text = ""
    try {
      text = await fs.readFile(file, "utf8")
    } catch {
      continue
    }
    const specs = extractRelativeImports(text)
    for (const spec of specs) {
      const normalized = spec.split("?")[0]?.split("#")[0] ?? spec
      if (!normalized.startsWith(".")) continue
      const hasExt = Boolean(path.extname(normalized))
      const base = path.resolve(path.dirname(file), normalized)
      const ok = await resolveImportTarget(base, hasExt, existsCache)
      if (!ok) {
        missing.push({ file, spec })
      }
    }
  }
  return missing
}

function extractRelativeImports(text: string) {
  const specs: string[] = []
  const importRe = /import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g
  const requireRe = /require\(\s*["']([^"']+)["']\s*\)/g
  const dynamicRe = /import\(\s*["']([^"']+)["']\s*\)/g
  for (const re of [importRe, requireRe, dynamicRe]) {
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const spec = match[1]
      if (spec && spec.startsWith(".")) specs.push(spec)
    }
  }
  return specs
}

async function resolveImportTarget(base: string, hasExt: boolean, existsCache: Map<string, boolean>) {
  const cacheKey = `${base}::${hasExt}`
  if (existsCache.has(cacheKey)) return existsCache.get(cacheKey) as boolean

  let resolved = false
  if (hasExt) {
    resolved = await existsFile(base)
  } else {
    if (await existsFile(base)) {
      resolved = true
    } else if (await existsDir(base)) {
      resolved = await existsAny(
        SOURCE_EXTS.map((ext) => path.join(base, `index${ext}`)),
        existsCache,
      )
    } else {
      resolved = await existsAny(
        SOURCE_EXTS.flatMap((ext) => [base + ext, path.join(base, `index${ext}`)]),
        existsCache,
      )
    }
  }
  existsCache.set(cacheKey, resolved)
  return resolved
}

async function existsAny(paths: string[], cache: Map<string, boolean>) {
  for (const candidate of paths) {
    const key = `exists:${candidate}`
    if (cache.has(key)) {
      if (cache.get(key)) return true
      continue
    }
    const ok = await existsFile(candidate)
    cache.set(key, ok)
    if (ok) return true
  }
  return false
}

async function existsFile(file: string) {
  try {
    const stat = await fs.stat(file)
    return stat.isFile()
  } catch {
    return false
  }
}

async function existsDir(file: string) {
  try {
    const stat = await fs.stat(file)
    return stat.isDirectory()
  } catch {
    return false
  }
}

function findStaleTests(sourceFiles: string[], testFiles: string[]) {
  const sourceBase = new Set(
    sourceFiles.map((file) => path.basename(file, path.extname(file)).toLowerCase()),
  )
  const stale: string[] = []
  for (const file of testFiles) {
    const base = path.basename(file).toLowerCase()
    const stripped = base
      .replace(/\.test\.[^\.]+$/, "")
      .replace(/\.spec\.[^\.]+$/, "")
      .replace(path.extname(base), "")
    if (!sourceBase.has(stripped)) stale.push(file)
  }
  return stale
}

async function findPromptAgentDrift(agentFile: string, promptFiles: string[], sourceFiles: string[]) {
  const issues: RepoHealthIssue[] = []
  let content = ""
  try {
    content = await fs.readFile(agentFile, "utf8")
  } catch {
    return issues
  }

  const importRe = /import\s+([A-Za-z0-9_]+)\s+from\s+["']\.\/prompt\/([^"']+)["']/g
  const usageRe = /prompt:\s*([A-Za-z0-9_]+)/g
  const promptImports = new Map<string, string>()
  const promptUsage = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = importRe.exec(content)) !== null) {
    promptImports.set(match[1], match[2])
  }
  while ((match = usageRe.exec(content)) !== null) {
    promptUsage.add(match[1])
  }

  for (const [variable, fileName] of promptImports.entries()) {
    const filePath = path.join(path.dirname(agentFile), "prompt", fileName)
    if (!(await existsFile(filePath))) {
      issues.push({
        id: "prompt-missing",
        severity: "error",
        title: "Prompt import references a missing file",
        detail: `${variable} -> ${fileName}`,
        files: [agentFile, filePath],
      })
    }
    if (!promptUsage.has(variable)) {
      issues.push({
        id: "prompt-unused",
        severity: "info",
        title: "Prompt import is not used by any agent definition",
        detail: `${variable} (${fileName})`,
        files: [agentFile],
      })
    }
  }

  for (const variable of promptUsage) {
    if (!promptImports.has(variable)) {
      issues.push({
        id: "prompt-usage-missing-import",
        severity: "error",
        title: "Agent uses a prompt variable without an import",
        detail: variable,
        files: [agentFile],
      })
    }
  }

  const promptNames = promptFiles.map((file) => path.basename(file))
  const promptRefs = await collectPromptReferences(sourceFiles)
  for (const prompt of promptNames) {
    if (!promptRefs.has(prompt)) {
      issues.push({
        id: "prompt-orphan",
        severity: "warn",
        title: "Prompt file is unreferenced",
        detail: prompt,
        files: [path.join(path.dirname(agentFile), "prompt", prompt)],
      })
    }
  }

  return issues
}

async function collectPromptReferences(sourceFiles: string[]) {
  const refs = new Set<string>()
  const re = /prompt\/([A-Za-z0-9_.-]+)\b/g
  for (const file of sourceFiles) {
    let text = ""
    try {
      text = await fs.readFile(file, "utf8")
    } catch {
      continue
    }
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      refs.add(match[1])
    }
  }
  return refs
}

async function findSubagentReferences(agentFile: string, referenceFiles: string[]) {
  const issues: RepoHealthIssue[] = []
  let content = ""
  try {
    content = await fs.readFile(agentFile, "utf8")
  } catch {
    return issues
  }

  const subagents = parseSubagentNames(content)
  if (subagents.length === 0) return issues

  const referenceText = await loadReferenceText(referenceFiles, agentFile)
  for (const name of subagents) {
    if (!referenceText.includes(name)) {
      issues.push({
        id: "subagent-unreferenced",
        severity: "warn",
        title: "Subagent is not referenced outside agent registry",
        detail: name,
        files: [agentFile],
      })
    }
  }
  return issues
}

function parseSubagentNames(content: string) {
  const names: string[] = []
  const lines = content.split(/\r?\n/)
  let currentName: string | undefined
  let currentMode: string | undefined
  for (const line of lines) {
    const nameMatch = line.match(/name:\s*"([^"]+)"/)
    if (nameMatch) currentName = nameMatch[1]
    const modeMatch = line.match(/mode:\s*"([^"]+)"/)
    if (modeMatch) currentMode = modeMatch[1]

    if (line.includes("},") || line.trim() === "}") {
      if (currentName && currentMode === "subagent") names.push(currentName)
      currentName = undefined
      currentMode = undefined
    }
  }
  return Array.from(new Set(names)).sort()
}

async function loadReferenceText(files: string[], exclude: string) {
  const chunks: string[] = []
  for (const file of files) {
    if (!file || file === exclude) continue
    try {
      chunks.push(await fs.readFile(file, "utf8"))
    } catch {
      continue
    }
  }
  return chunks.join("\n")
}



