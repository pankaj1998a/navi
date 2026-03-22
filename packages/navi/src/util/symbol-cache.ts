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
    const CACHE_TTL = 1000 * 60 * 5 // 5 minutes

    export async function getSymbols(): Promise<SymbolInfo[]> {
        if (cache && (Date.now() - lastUpdate < CACHE_TTL)) {
            return cache
        }
        await update()
        return cache || []
    }

    export async function update() {
        log.info("updating symbol cache")
        const symbols: SymbolInfo[] = []

        try {
            // Use ripgrep to quickly find common definitions
            // This is a fast fallback for a full parser
            const result = await $`rg --line-number --json -e "^(export\s+)?(class|function|interface|const|let|var)\s+([a-zA-Z0-9_]+)"`
                .cwd(Instance.directory)
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

                            // Basic extraction logic
                            const match = content.match(/(class|function|interface|const|let|var)\s+([a-zA-Z0-9_]+)/)
                            if (match) {
                                symbols.push({
                                    name: match[2],
                                    type: (match[1] === "class" ? "class" :
                                        match[1] === "interface" ? "interface" : "function") as any,
                                    line: lineNumber,
                                    file: path.join(Instance.directory, filePath)
                                })
                            }
                        }
                    } catch (e) {
                        // Skip malformed JSON
                    }
                }
            }

            cache = symbols
            lastUpdate = Date.now()
            log.info(`cached ${symbols.length} symbols`)
        } catch (error) {
            log.error("failed to update symbol cache", { error })
        }
    }

    export async function findSymbol(name: string): Promise<SymbolInfo | null> {
        const symbols = await getSymbols()
        return symbols.find(s => s.name === name) || null
    }
}
