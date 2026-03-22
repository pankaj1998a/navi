import z from "zod"
import { Tool } from "./tool"
import { grep } from "@navi-ai/native"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"
import path from "path"
import { assertExternalDirectory } from "./external-directory"

const MAX_LINE_LENGTH = 2000

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    await ctx.ask({
      permission: "grep",
      patterns: [params.pattern],
      always: ["*"],
      metadata: {
        pattern: params.pattern,
        path: params.path,
        include: params.include,
      },
    })

    let searchPath = params.path ?? Instance.directory
    searchPath = path.isAbsolute(searchPath) ? searchPath : path.resolve(Instance.directory, searchPath)
    await assertExternalDirectory(ctx, searchPath, { kind: "directory" })

    try {

      const result = await grep(params.pattern, searchPath, params.include, 100)

      if (result.matches.length === 0) {
        return {
          title: params.pattern,
          metadata: { matches: 0, truncated: false },
          output: "No files found",
        }
      }

      const outputLines = [`Found ${result.count} matches`]

      let currentFile = ""
      for (const match of result.matches) {
        if (currentFile !== match.path) {
          if (currentFile !== "") {
            outputLines.push("")
          }
          currentFile = match.path
          outputLines.push(`${match.path}:`)
        }
        const truncatedLineText =
          match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
        outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
      }

      if (result.truncated) {
        outputLines.push("")
        outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
      }

      return {
        title: params.pattern,
        metadata: {
          matches: result.count,
          truncated: result.truncated,
        },
        output: outputLines.join("\n"),
      }
    } catch (e) {
      throw new Error(`grep failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
})
