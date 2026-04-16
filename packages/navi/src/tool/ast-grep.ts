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
import { Log } from "../util/log"
import { astGrep } from "../native"

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

const DEFAULT_MAX_MATCHES = 100

export const AstGrepTool = Tool.define("ast_grep", async () => {
    return {
        description: DESCRIPTION,
        parameters,
        async execute(params: z.infer<typeof parameters>, ctx) {
            log.info("Running ast-grep native", { params })

            try {
                const result = astGrep(
                    params.pattern,
                    params.language,
                    params.paths,
                    params.rewrite
                )

                if (result.matches.length === 0) {
                    return {
                        title: "No matches found",
                        metadata: { totalMatches: 0 } as any,
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
                    } as any,
                    output,
                }
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e)
                return {
                    title: "AST Search Error",
                    metadata: { error } as any,
                    output: `Error: ${error}`,
                }
            }
        },
    }
})


