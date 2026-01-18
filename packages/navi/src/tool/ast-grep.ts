/**
 * AST-grep Tool for Navi
 *
 * Structural code search using Abstract Syntax Trees.
 * More precise than text-based grep - matches actual code patterns.
 *
 * Ported from oh-my-navi-dev plugin
 */

import { Tool } from "./tool"
import DESCRIPTION from "./ast-grep.txt"
import z from "zod"
import { spawn } from "bun"
import { existsSync } from "node:fs"
import { which } from "bun"
import { Log } from "../util/log"

const log = Log.create({ service: "ast-grep" })

// Supported languages
const LANGUAGES = [
    "typescript",
    "javascript",
    "python",
    "go",
    "rust",
    "java",
    "c",
    "cpp",
    "ruby",
    "php",
    "kotlin",
    "swift",
    "csharp",
    "scala",
    "lua",
    "html",
    "css",
] as const

type Language = (typeof LANGUAGES)[number]

const parameters = z.object({
    pattern: z.string().describe("The AST pattern to search for"),
    language: z
        .enum(LANGUAGES)
        .describe("The programming language of the code to search"),
    paths: z
        .array(z.string())
        .optional()
        .describe("Optional list of directories or files to search"),
    rewrite: z
        .string()
        .optional()
        .describe("Optional replacement pattern for find-and-replace"),
    update_all: z
        .boolean()
        .optional()
        .describe("If true and rewrite is provided, apply changes to files"),
})

// Default limits
const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_MATCHES = 100

interface AstGrepMatch {
    file: string
    range: {
        start: { line: number; column: number }
        end: { line: number; column: number }
    }
    text: string
    replacement?: string
}

/**
 * Find the ast-grep CLI binary
 */
async function findSgPath(): Promise<string | null> {
    // Check common paths
    const possiblePaths = [
        "sg", // In PATH
        "ast-grep", // Alternative name
        "./node_modules/.bin/sg", // Local install
        "./node_modules/@ast-grep/cli/sg", // NPM package
    ]

    for (const path of possiblePaths) {
        try {
            const whichPath = which(path)
            if (whichPath && existsSync(whichPath)) {
                return whichPath
            }
        } catch { }

        if (existsSync(path)) {
            return path
        }
    }

    return null
}

/**
 * Run ast-grep with the given parameters
 */
async function runAstGrep(params: z.infer<typeof parameters>): Promise<{
    matches: AstGrepMatch[]
    totalMatches: number
    truncated: boolean
    error?: string
}> {
    const sgPath = await findSgPath()

    if (!sgPath) {
        return {
            matches: [],
            totalMatches: 0,
            truncated: false,
            error: `ast-grep CLI not found. Install via:
  bun add -D @ast-grep/cli
  cargo install ast-grep --locked
  brew install ast-grep`,
        }
    }

    const args = ["run", "-p", params.pattern, "--lang", params.language, "--json=compact"]

    if (params.rewrite) {
        args.push("-r", params.rewrite)
        if (params.update_all) {
            args.push("--update-all")
        }
    }

    const paths = params.paths && params.paths.length > 0 ? params.paths : ["."]
    args.push(...paths)

    log.info("Running ast-grep", { args })

    const proc = spawn([sgPath, ...args], {
        stdout: "pipe",
        stderr: "pipe",
    })

    // Timeout handling
    const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
            proc.kill()
            reject(new Error(`Search timeout after ${DEFAULT_TIMEOUT_MS}ms`))
        }, DEFAULT_TIMEOUT_MS)
        proc.exited.then(() => clearTimeout(id))
    })

    let stdout: string
    let stderr: string
    let exitCode: number

    try {
        stdout = await Promise.race([new Response(proc.stdout).text(), timeoutPromise])
        stderr = await new Response(proc.stderr).text()
        exitCode = await proc.exited
    } catch (e) {
        const error = e as Error
        if (error.message?.includes("timeout")) {
            return {
                matches: [],
                totalMatches: 0,
                truncated: true,
                error: error.message,
            }
        }
        return {
            matches: [],
            totalMatches: 0,
            truncated: false,
            error: `Failed to run ast-grep: ${error.message}`,
        }
    }

    // Handle errors
    if (exitCode !== 0 && stdout.trim() === "") {
        if (stderr.includes("No files found")) {
            return { matches: [], totalMatches: 0, truncated: false }
        }
        if (stderr.trim()) {
            return { matches: [], totalMatches: 0, truncated: false, error: stderr.trim() }
        }
        return { matches: [], totalMatches: 0, truncated: false }
    }

    if (!stdout.trim()) {
        return { matches: [], totalMatches: 0, truncated: false }
    }

    // Parse JSON output
    let matches: AstGrepMatch[] = []
    try {
        matches = JSON.parse(stdout) as AstGrepMatch[]
    } catch {
        return { matches: [], totalMatches: 0, truncated: false, error: "Failed to parse ast-grep output" }
    }

    const totalMatches = matches.length
    const truncated = totalMatches > DEFAULT_MAX_MATCHES
    const finalMatches = truncated ? matches.slice(0, DEFAULT_MAX_MATCHES) : matches

    return {
        matches: finalMatches,
        totalMatches,
        truncated,
    }
}

export const AstGrepTool = Tool.define("ast_grep", async () => {
    return {
        description: DESCRIPTION,
        parameters,
        async execute(params: z.infer<typeof parameters>, ctx) {
            const result = await runAstGrep(params)

            if (result.error) {
                return {
                    title: "AST Search Error",
                    metadata: { error: result.error },
                    output: `Error: ${result.error}`,
                }
            }

            if (result.matches.length === 0) {
                return {
                    title: "No matches found",
                    metadata: { totalMatches: 0 },
                    output: `No matches found for pattern: \`${params.pattern}\` in ${params.language} files.`,
                }
            }

            // Format output
            let output = `Found ${result.totalMatches} match${result.totalMatches !== 1 ? "es" : ""}`
            if (result.truncated) {
                output += ` (showing first ${DEFAULT_MAX_MATCHES})`
            }
            output += `\n\n`

            for (const match of result.matches) {
                output += `## ${match.file}:${match.range.start.line}\n`
                output += "```" + params.language + "\n"
                output += match.text + "\n"
                output += "```\n"
                if (match.replacement) {
                    output += "→ Replaced with:\n```" + params.language + "\n"
                    output += match.replacement + "\n"
                    output += "```\n"
                }
                output += "\n"
            }

            return {
                title: `${result.totalMatches} match${result.totalMatches !== 1 ? "es" : ""}`,
                metadata: {
                    totalMatches: result.totalMatches,
                    truncated: result.truncated,
                },
                output,
            }
        },
    }
})
