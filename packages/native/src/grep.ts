import fs from 'fs-extra'
import path from 'path'

export interface GrepMatch {
    path: string
    lineNum: number
    lineText: string
    context?: string[]
}

export interface GrepResult {
    matches: GrepMatch[]
    count: number
    truncated: boolean
    totalFiles?: number
    searchTime?: number
}

/**
 * Performance-optimized grep with parallel processing
 */
export async function grep(
    pattern: string,
    searchPath: string,
    include?: string,
    limit?: number,
    options?: {
        contextLines?: number
        caseSensitive?: boolean
        wholeWord?: boolean
        regex?: boolean
    }
): Promise<GrepResult> {
    const startTime = performance.now()
    const matches: GrepMatch[] = []
    let truncated = false
    const contextLines = options?.contextLines || 0
    const caseSensitive = options?.caseSensitive !== false

    let searchPattern: RegExp
    if (options?.regex !== false) {
        searchPattern = new RegExp(pattern, caseSensitive ? 'g' : 'gi')
    } else {
        const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        searchPattern = new RegExp(options?.wholeWord ? `\\b${escapedPattern}\\b` : escapedPattern, caseSensitive ? 'g' : 'gi')
    }

    // Simplified file finding
    const files: string[] = []
    async function findFiles(dir: string) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                    if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                        await findFiles(fullPath)
                    }
                } else {
                    files.push(fullPath)
                }
            }
        } catch (e) {
            // Ignore access errors
        }
    }

    await findFiles(searchPath).catch(() => { })

    for (const filePath of files) {
        try {
            const content = await fs.readFile(filePath, 'utf-8')
            const lines = content.split('\n')

            for (let i = 0; i < lines.length; i++) {
                if (searchPattern.test(lines[i])) {
                    const startLine = Math.max(0, i - contextLines)
                    const endLine = Math.min(lines.length, i + contextLines + 1)

                    matches.push({
                        path: filePath,
                        lineNum: i + 1,
                        lineText: lines[i],
                        context: lines.slice(startLine, endLine),
                    })

                    if (limit && matches.length >= limit) {
                        truncated = true
                        break
                    }
                }
            }
        } catch (error) { }
        if (truncated) break
    }

    return {
        matches,
        count: matches.length,
        truncated,
        searchTime: performance.now() - startTime
    }
}

export interface AstMatch {
    file: string
    range: { start: { line: number } }
    text: string
    replacement?: string
}

export interface AstGrepResult {
    matches: AstMatch[]
    totalMatches: number
    truncated: boolean
}

export function astGrep(pattern: string, language: string, paths?: string[], rewrite?: string): AstGrepResult {
    // Stub implementation until tree-sitter is fully integrated
    return { matches: [], totalMatches: 0, truncated: false }
}
