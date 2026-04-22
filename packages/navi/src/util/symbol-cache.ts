import { $ } from "bun"
import { Log } from "./log"
import { Instance } from "../project/instance"
import path from "path"

const log = Log.create({ service: "symbol-cache" })

export interface SymbolInfo {
    name: string
    type: "function" | "class" | "interface" | "method"
    line: number
    file: string
}

export namespace SymbolCache {
    let cache: SymbolInfo[] | null = null
    let lastUpdate = 0
    let updating = false
    const CACHE_TTL = 1000 * 60 * 5 // 5 minutes

    export async function getSymbols(directory?: string): Promise<SymbolInfo[]> {
        if (cache && (Date.now() - lastUpdate < CACHE_TTL)) {
            return cache
        }
        await update(directory)
        return cache || []
    }

    export async function update(directory?: string) {
        if (updating) return
        updating = true
        log.info("updating symbol cache")
        const symbols: SymbolInfo[] = []

        try {
            // Priority: provided directory > Instance.directory > cwd
            let dir = directory
            if (!dir) {
                try {
                    dir = Instance.directory
                } catch {
                    dir = process.cwd()
                }
            }

            // Use ripgrep to quickly find common definitions
            const result = await $`rg --line-number --json -e "^(export\\s+)?(class|function|interface|const|let|var)\\s+([a-zA-Z0-9_]+)"`
                .cwd(dir)
                .nothrow()
                .quiet()
                .text()

            if (result) {
                const lines = result.trim().split("\n")
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line)
                        if (data.type === "match") {
                            const filePath = data.data.path.text
                            const lineNumber = data.data.line_number
                            const content = data.data.lines.text

                            const match = content.match(/(class|function|interface|const|let|var)\s+([a-zA-Z0-9_]+)/)
                            if (match) {
                                symbols.push({
                                    name: match[2],
                                    type: (match[1] === "class" ? "class" :
                                        match[1] === "interface" ? "interface" : "function") as SymbolInfo["type"],
                                    line: lineNumber,
                                    file: path.join(dir, filePath)
                                })
                            }
                        }
                    } catch (e) {
                        // Ignore individual line parse errors
                    }
                }
            }
            cache = symbols
            lastUpdate = Date.now()
        } catch (e) {
            log.error("failed to update symbol cache", { error: e })
        } finally {
            updating = false
        }
    }
}

export interface CodebaseMapSummary {
    symbolCount: number
    hotspots: Array<{
        file: string
        symbolCount: number
    }>
}

/**
 * Summarizes the symbol distribution to provide a high-level map of the codebase.
 */
export function summarizeSymbols(symbols: SymbolInfo[], cwd: string, limit: number = 5): string {
    if (!symbols || symbols.length === 0) return "No symbols found."

    const fileCounts = new Map<string, number>()
    symbols.forEach((s) => {
        const rel = path.relative(cwd, s.file)
        const parts = rel.split(path.sep)
        // Group by top-level directory or file
        const key = parts.length > 1 ? parts[0] : (parts[0] || "root")
        fileCounts.set(key, (fileCounts.get(key) || 0) + 1)
    })

    const sorted = Array.from(fileCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)

    let output = `Codebase Map (${symbols.length} symbols):\n`
    sorted.forEach(([dir, count]) => {
        output += `  • ${dir}: ${count} symbols\n`
    })

    return output.trim()
}



