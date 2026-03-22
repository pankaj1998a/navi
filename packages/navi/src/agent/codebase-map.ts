import path from "path"
import type { SymbolInfo } from "@/util/symbol-cache"

export interface CodebaseSymbolGroup {
  file: string
  symbolCount: number
  symbols: SymbolInfo[]
  purpose: string
}

export interface CodebaseMapSummary {
  symbolCount: number
  fileCount: number
  hotspots: CodebaseSymbolGroup[]
}

export function summarizeSymbols(symbols: SymbolInfo[], root = process.cwd(), maxHotspots = 12): CodebaseMapSummary {
  const groups = groupSymbolsByFile(symbols, root)
  const hotspots = [...groups.values()]
    .sort((a, b) => b.symbolCount - a.symbolCount || a.file.localeCompare(b.file))
    .slice(0, maxHotspots)

  return {
    symbolCount: symbols.length,
    fileCount: groups.size,
    hotspots,
  }
}

export function renderSymbolIndex(symbols: SymbolInfo[], root = process.cwd(), maxSymbolsPerFile = 40): string {
  if (!symbols.length) {
    return [
      "# Symbol Index",
      "",
      "No symbols were indexed. Refresh the cache or broaden the scan scope.",
      "",
    ].join("\n")
  }

  const summary = summarizeSymbols(symbols, root)
  const grouped = [...groupSymbolsByFile(symbols, root).values()]
    .sort((a, b) => b.symbolCount - a.symbolCount || a.file.localeCompare(b.file))

  const lines: string[] = []
  lines.push("# Symbol Index")
  lines.push("")
  lines.push(`- Symbols indexed: ${summary.symbolCount}`)
  lines.push(`- Files indexed: ${summary.fileCount}`)
  lines.push("")
  lines.push("## Hotspots")
  for (const group of summary.hotspots) {
    lines.push(`- \`${group.file}\` (${group.symbolCount} symbols)`)
    lines.push(`  - Purpose: ${group.purpose}`)
  }
  lines.push("")
  lines.push("## File Directory")
  for (const group of grouped) {
    lines.push(`### \`${group.file}\``)
    lines.push(`- Purpose: ${group.purpose}`)
    const entries = group.symbols
      .slice(0, maxSymbolsPerFile)
      .sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))
    for (const symbol of entries) {
      lines.push(`- \`${symbol.name}\` (${symbol.type}) -> \`${group.file}:${symbol.line}\``)
    }
    if (group.symbols.length > entries.length) {
      lines.push(`- ... ${group.symbols.length - entries.length} more symbols omitted`)
    }
    lines.push("")
  }
  lines.push("## Symbol Lookup")
  const lookup = [...symbols].sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line)
  const lookupLimit = Math.min(lookup.length, 200)
  for (const symbol of lookup.slice(0, lookupLimit)) {
    lines.push(`- \`${symbol.name}\` (${symbol.type}) -> \`${relativePath(root, symbol.file)}:${symbol.line}\``)
  }
  if (lookup.length > lookupLimit) {
    lines.push(`- ... ${lookup.length - lookupLimit} more symbols omitted`)
  }
  lines.push("")
  return lines.join("\n")
}

function groupSymbolsByFile(symbols: SymbolInfo[], root: string) {
  const groups = new Map<string, CodebaseSymbolGroup>()
  for (const symbol of symbols) {
    const file = relativePath(root, symbol.file)
    const current = groups.get(file)
    if (current) {
      current.symbols.push(symbol)
      current.symbolCount = current.symbols.length
      continue
    }
    groups.set(file, {
      file,
      symbolCount: 1,
      symbols: [symbol],
      purpose: inferFilePurpose(file, [symbol]),
    })
  }
  for (const group of groups.values()) {
    group.purpose = inferFilePurpose(group.file, group.symbols)
  }
  return groups
}

function relativePath(root: string, target: string) {
  const rel = path.relative(root, target).replace(/\\/g, "/")
  return rel || path.basename(target)
}

function inferFilePurpose(file: string, symbols: SymbolInfo[]) {
  const lower = file.toLowerCase()

  if (lower.includes("/agent/prompt/")) {
    return "Prompt template that shapes an agent's behavior, constraints, and output style."
  }
  if (lower.includes("/agent/defaults/")) {
    return "Default agent configuration and built-in behavior guidance."
  }
  if (lower.includes("/agent/")) {
    return "Agent registry, routing, orchestration, policy, or agent-specific runtime logic."
  }
  if (lower.includes("/session/")) {
    return "Session lifecycle, turn flow, prompt assembly, memory, or state management."
  }
  if (lower.includes("/tool/")) {
    return "Tool implementation used by agents to inspect, modify, or automate the project."
  }
  if (lower.includes("/provider/")) {
    return "Provider/model catalog, health, capability, or routing data."
  }
  if (lower.includes("/config/")) {
    return "Configuration schema, defaults, and persisted settings."
  }
  if (lower.includes("/cli/")) {
    return "Command-line interface commands and terminal UX."
  }
  if (lower.includes("/test/")) {
    return "Regression coverage for the surrounding subsystem."
  }
  if (lower.includes("/util/")) {
    return "Shared utility logic reused across subsystems."
  }

  const symbolCount = symbols.length
  if (symbolCount === 1) {
    return `Single-symbol file centered on \`${symbols[0].name}\`.`
  }
  return "General implementation file within the project."
}
