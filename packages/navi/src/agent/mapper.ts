import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { Log } from "../util/log"

const log = Log.create({ service: "mapper" })

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SymbolEntry {
  name: string
  kind: "class" | "function" | "interface" | "type" | "enum" | "const" | "component" | "export"
  line: number
  exported: boolean
  defaultExport?: boolean
}

export interface FileNode {
  relativePath: string
  absolutePath: string
  sizeBytes: number
  symbolCount: number
  symbols: SymbolEntry[]
  imports: string[]        // relative paths of files this file imports
  exports: string[]        // named exports from this file
  purpose: string          // inferred one-line description
  isEntryPoint: boolean
}

export interface ProjectIndex {
  root: string
  generatedAt: string
  fileCount: number
  symbolCount: number
  files: FileNode[]
  dependencyEdges: Array<{ from: string; to: string }>
  hotspots: Array<{ file: string; symbolCount: number; purpose: string }>
  entryPoints: string[]
}

// ─── Core Mapper ─────────────────────────────────────────────────────────────

export namespace Mapper {

  const IGNORE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", ".turbo",
    "coverage", ".cache", "__pycache__", ".vibe", ".map"
  ])

  const CODE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h"
  ])

  // ── File Discovery ──────────────────────────────────────────────────────

  async function discoverFiles(root: string): Promise<string[]> {
    const files: string[] = []

    async function walk(dir: string) {
      let entries: Awaited<ReturnType<typeof fs.readdir>>
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name))) {
          files.push(fullPath)
        }
      }
    }

    await walk(root)
    return files
  }

  // ── Symbol Extraction ────────────────────────────────────────────────────

  const SYMBOL_PATTERNS = [
    // Exported class/abstract class
    /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    // Exported function/async function
    /^export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    // Exported arrow function/component
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:\(?.*?\)?)\s*=>/,
    // Exported interface
    /^export\s+interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    // Exported type alias
    /^export\s+type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[=<]/,
    // Exported enum
    /^export\s+(?:const\s+)?enum\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    // Exported namespace/module
    /^export\s+(?:namespace|module)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    // Exported const/let/var
    /^export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    // Non-exported class
    /^(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    // Non-exported function
    /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/,
    // Effect/Domain specific patterns
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*Layer\./,
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*Effect\./,
  ]

  function kindFromLine(line: string): SymbolEntry["kind"] {
    const l = line.trim()
    if (/\bclass\b/.test(l)) return "class"
    if (/\binterface\b/.test(l)) return "interface"
    if (/\btype\b/.test(l)) return "type"
    if (/\benum\b/.test(l)) return "enum"
    if (/\bnamespace\b|\bmodule\b/.test(l)) return "export"
    if (/\bfunction\b/.test(l)) return "function"
    if (/=>/.test(l)) {
      if (/[A-Z]/.test(l.split("=")[0])) return "component"
      return "function"
    }
    if (/const\s+[A-Z]/.test(l)) return "component"
    return "const"
  }

  async function extractSymbols(filePath: string): Promise<SymbolEntry[]> {
    let content: string
    try {
      content = await fs.readFile(filePath, "utf8")
    } catch {
      return []
    }

    const symbols: SymbolEntry[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimStart()
      if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue

      for (const pattern of SYMBOL_PATTERNS) {
        const match = line.match(pattern)
        if (match) {
          const symbolName = match[1]
          if (!symbolName) continue

          const isExported = line.startsWith("export")
          symbols.push({
            name: symbolName,
            kind: kindFromLine(line),
            line: i + 1,
            exported: isExported,
            defaultExport: /\bdefault\b/.test(line),
          })
          break
        }
      }

      // Default export: function or class without name (handled by filename usually but let's be safe)
      if (/^export\s+default\s+(?:function|class)/.test(line)) {
        const m = line.match(/^export\s+default\s+(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
        if (m && !symbols.find(s => s.name === m[1])) {
          symbols.push({ name: m[1], kind: kindFromLine(line), line: i + 1, exported: true, defaultExport: true })
        }
      }
    }

    return symbols
  }


  // ── Import / Dependency Parsing ──────────────────────────────────────────

  async function extractImports(filePath: string, root: string): Promise<string[]> {
    let content: string
    try {
      content = await fs.readFile(filePath, "utf8")
    } catch {
      return []
    }

    const resolved: string[] = []
    const importPattern = /^(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/gm
    const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm

    const candidates: string[] = []
    let m: RegExpExecArray | null
    while ((m = importPattern.exec(content)) !== null) candidates.push(m[1])
    while ((m = requirePattern.exec(content)) !== null) candidates.push(m[1])

    const dir = path.dirname(filePath)
    for (const spec of candidates) {
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue // skip package imports
      const candidate = path.resolve(dir, spec)
      // Try with extensions
      for (const ext of [".ts", ".tsx", ".js", ".jsx", ""]) {
        const withExt = ext ? candidate + ext : candidate
        try {
          await fs.access(withExt)
          resolved.push(path.relative(root, withExt).replace(/\\/g, "/"))
          break
        } catch {
          // also try index
          const asIndex = path.join(candidate, "index" + ext)
          try {
            await fs.access(asIndex)
            resolved.push(path.relative(root, asIndex).replace(/\\/g, "/"))
            break
          } catch {
            // not found
          }
        }
      }
    }

    return [...new Set(resolved)]
  }

  // ── Purpose Inference ────────────────────────────────────────────────────

  function inferPurpose(relativePath: string, symbols: SymbolEntry[]): string {
    const lower = relativePath.toLowerCase()
    const parts = lower.split("/")
    const base = path.basename(lower, path.extname(lower))

    if (parts.includes("test") || parts.includes("__tests__") || base.endsWith(".test") || base.endsWith(".spec"))
      return "Test suite"
    if (parts.includes("agent")) {
      if (base.includes("orchestrat")) return "Agent orchestrator — coordinates multi-agent workflows"
      if (base.includes("runner")) return "Agent runner — executes agent instances"
      if (base.includes("spawn")) return "Agent spawner — creates and manages agent lifecycles"
      if (base.includes("memory")) return "Agent memory — stores and retrieves contextual facts"
      if (base.includes("prompt")) return "Prompt template — shapes agent behaviour and output"
      if (base.includes("roles") || parts.includes("roles")) return "Agent role definition"
      return "Agent subsystem module"
    }
    if (parts.includes("session")) return "Session management — turn flow, prompt assembly, state"
    if (parts.includes("tool")) return "Tool implementation — agent-executable capability"
    if (parts.includes("provider")) return "Model provider — LLM routing and capability data"
    if (parts.includes("config")) return "Configuration — schema, defaults, persisted settings"
    if (parts.includes("cli")) return "CLI module — command-line interface and terminal UX"
    if (parts.includes("util")) return "Utility module — shared helpers across subsystems"
    if (parts.includes("plugin")) return "Plugin API — extensibility surface"
    if (base === "index") return "Barrel export / module entry point"

    const exportedClasses = symbols.filter(s => s.kind === "class" && s.exported).map(s => s.name)
    if (exportedClasses.length > 0)
      return `Class module — exports: ${exportedClasses.slice(0, 3).join(", ")}`

    const exportedFns = symbols.filter(s => s.kind === "function" && s.exported).map(s => s.name)
    if (exportedFns.length > 0)
      return `Function module — exports: ${exportedFns.slice(0, 3).join(", ")}`

    return "Implementation module"
  }

  // ── Directory Tree ───────────────────────────────────────────────────────

  async function buildDirectoryTree(root: string, prefix = "", currentDir = root, depth = 0): Promise<string[]> {
    if (depth > 8) return []
    const lines: string[] = []
    let entries: Awaited<ReturnType<typeof fs.readdir>>
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return []
    }

    const filtered = entries
      .filter(e => !IGNORE_DIRS.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i]
      const isLast = i === filtered.length - 1
      const connector = isLast ? "└── " : "├── "
      const childPrefix = isLast ? "    " : "│   "
      lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`)
      if (entry.isDirectory() && depth < 4) {
        const children = await buildDirectoryTree(root, prefix + childPrefix, path.join(currentDir, entry.name), depth + 1)
        lines.push(...children)
      }
    }
    return lines
  }

  // ── Markdown Renderer ────────────────────────────────────────────────────

  export function renderIndex(index: ProjectIndex): string {
    const lines: string[] = []

    lines.push(`# 🗺️ Project Map: ${path.basename(index.root)}`)
    lines.push(``)
    lines.push(`> 🕒 Generated: ${index.generatedAt} | 📂 Files: **${index.fileCount}** | 🧩 Symbols: **${index.symbolCount}**`)
    lines.push(``)
    lines.push(`---`)
    lines.push(``)

    // ── Project Blueprint (Compact Architecture)
    lines.push(`## 🏗️ Project Blueprint`)
    lines.push(``)
    lines.push(`| Domain | Primary Files | Module Count | Purpose |`)
    lines.push(`|--------|---------------|--------------|---------|`)
    
    // Group files by domain (top-level folders)
    const domains = new Map<string, { files: string[], symbols: number, count: number }>()
    for (const f of index.files) {
      const d = f.relativePath.split("/")[0] || "root"
      if (!domains.has(d)) domains.set(d, { files: [], symbols: 0, count: 0 })
      const data = domains.get(d)!
      if (data.files.length < 3) data.files.push(path.basename(f.relativePath))
      data.symbols += f.symbolCount
      data.count++
    }

    for (const [name, data] of domains) {
      lines.push(`| **${name}** | ${data.files.join(", ")} | ${data.count} | ${data.count > 5 ? "Subsystem" : "Support"} |`)
    }
    lines.push(``)

    // ── Entry Points
    if (index.entryPoints.length > 0) {
      lines.push(`### 🚀 Entry Points`)
      lines.push(index.entryPoints.map(ep => `\`${ep}\``).join(" → "))
      lines.push(``)
    }

    // ── Hotspots (Token Dense)
    lines.push(`## 🔥 Complexity Hotspots`)
    lines.push(``)
    for (const h of index.hotspots.slice(0, 10)) {
      lines.push(`- \`${h.file}\` (${h.symbolCount} sym) — *${h.purpose}*`)
    }
    lines.push(``)

    // ── Deep Symbol Map (Per Domain)
    lines.push(`## 📂 Comprehensive Symbol Map`)
    lines.push(``)
    for (const [domain, data] of domains) {
      lines.push(`<details>`)
      lines.push(`<summary><b>${domain}</b> (${data.count} files)</summary>`)
      lines.push(``)
      for (const file of index.files.filter(f => (f.relativePath.split("/")[0] || "root") === domain)) {
        if (file.symbols.length === 0) continue
        const symbols = file.symbols
          .filter(s => s.exported)
          .map(s => `\u0060${s.name}\u0060`)
          .join(", ")
        lines.push(`- **${file.relativePath}**: ${symbols || "*Internal only*"}`)
      }
      lines.push(``)
      lines.push(`</details>`)
    }

    return lines.join("\n")
  }


  // ── Main Entry ───────────────────────────────────────────────────────────

  export async function run(root: string): Promise<ProjectIndex> {
    log.info("Mapper: starting deep index", { root })

    const absoluteFiles = await discoverFiles(root)
    log.info("Mapper: discovered files", { count: absoluteFiles.length })

    const files: FileNode[] = []
    const dependencyEdges: Array<{ from: string; to: string }> = []
    let totalSymbols = 0

    for (const absPath of absoluteFiles) {
      const relativePath = path.relative(root, absPath).replace(/\\/g, "/")
      let sizeBytes = 0
      try {
        const stat = await fs.stat(absPath)
        sizeBytes = stat.size
      } catch {}

      const [symbols, imports] = await Promise.all([
        extractSymbols(absPath),
        extractImports(absPath, root),
      ])

      const purpose = inferPurpose(relativePath, symbols)
      const isEntryPoint = /\b(index|main|app|server|cli)\.(ts|tsx|js|jsx)$/.test(relativePath)

      const fileNode: FileNode = {
        relativePath,
        absolutePath: absPath,
        sizeBytes,
        symbolCount: symbols.length,
        symbols,
        imports,
        exports: symbols.filter(s => s.exported).map(s => s.name),
        purpose,
        isEntryPoint,
      }

      files.push(fileNode)
      totalSymbols += symbols.length

      for (const imp of imports) {
        dependencyEdges.push({ from: relativePath, to: imp })
      }
    }

    const hotspots = [...files]
      .sort((a, b) => b.symbolCount - a.symbolCount)
      .slice(0, 20)
      .map(f => ({ file: f.relativePath, symbolCount: f.symbolCount, purpose: f.purpose }))

    const entryPoints = files.filter(f => f.isEntryPoint).map(f => f.relativePath)

    const index: ProjectIndex = {
      root,
      generatedAt: new Date().toISOString(),
      fileCount: files.length,
      symbolCount: totalSymbols,
      files,
      dependencyEdges,
      hotspots,
      entryPoints,
    }

    log.info("Mapper: index complete", { files: files.length, symbols: totalSymbols, edges: dependencyEdges.length })
    return index
  }

  // ── Write to Disk ────────────────────────────────────────────────────────

  export async function writeIndex(root: string, index?: ProjectIndex): Promise<string> {
    const idx = index ?? await run(root)
    const outputDir = path.join(root, ".map")
    await fs.mkdir(outputDir, { recursive: true })

    // Write structured JSON for agent consumption
    const jsonPath = path.join(outputDir, "index.json")
    await fs.writeFile(jsonPath, JSON.stringify(idx, null, 2), "utf8")

    // Write human-readable markdown
    const mdPath = path.join(outputDir, "index.md")
    const md = renderIndex(idx)
    await fs.writeFile(mdPath, md, "utf8")

    // Write directory tree separately
    const treeLines = [
      `# Directory Tree`,
      ``,
      "```",
      path.basename(root) + "/",
      ...(await buildDirectoryTree(root)),
      "```",
    ]
    await fs.writeFile(path.join(outputDir, "tree.md"), treeLines.join("\n"), "utf8")

    log.info("Mapper: wrote index artifacts", { dir: outputDir })
    return mdPath
  }
}
