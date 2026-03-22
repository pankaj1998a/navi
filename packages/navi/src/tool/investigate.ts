import z from "zod"
import { Tool } from "./tool"
import { SymbolCache } from "../util/symbol-cache"
import { Log } from "../util/log"
import path from "path"
import { Instance } from "../project/instance"
import { renderSymbolIndex, summarizeSymbols } from "../agent/codebase-map"

const log = Log.create({ service: "investigate-tool" })

export const InvestigateTool = Tool.define("investigate", {
  description: `Investigate the local codebase to map architecture, build symbol indexes, and find symbol definitions.
This tool uses a local cache to quickly find classes, functions, and interfaces across the entire project.
Use this to understand system-wide dependencies, locate entry points, and produce reusable project maps.`,
  parameters: z.object({
    query: z.string().describe("The name of the symbol (class, function, etc.) to investigate"),
    action: z.enum(["find", "map", "refresh"]).describe("The investigation action to perform"),
  }),
  async execute(params, ctx) {
    if (params.action === "refresh") {
      await SymbolCache.update()
      return {
        title: "Symbol Cache Refreshed",
        output: "Successfully updated the local symbol cache.",
        metadata: {} as Record<string, any>
      }
    }

    if (params.action === "find") {
      await SymbolCache.update().catch(() => undefined)
      const symbols = await SymbolCache.getSymbols()
      const matches = symbols.filter(s =>
        s.name.toLowerCase().includes(params.query.toLowerCase()) ||
        s.file.toLowerCase().includes(params.query.toLowerCase())
      )

      if (matches.length === 0) {
        return {
          title: `Investigation: ${params.query}`,
          output: `No symbols found matching "${params.query}".`,
          metadata: { matches: [] }
        }
      }

      const output = matches.map(s =>
        `- **${s.name}** (${s.type})
  File: ${path.relative(Instance.worktree, s.file)}:${s.line}`
      ).join("\n")

      return {
        title: `Investigation: ${params.query}`,
        output: `Found ${matches.length} matches:

${output}`,
        metadata: { matches }
      }
    }

    if (params.action === "map") {
      // Basic architecture mapping: find all symbols in a directory
      await SymbolCache.update().catch(() => undefined)
      const symbols = await SymbolCache.getSymbols()
      const dirPath = path.isAbsolute(params.query) ? params.query : path.join(Instance.directory, params.query)
      const matches = symbols.filter(s => s.file.startsWith(dirPath))

      if (matches.length === 0) {
        return {
          title: `Architecture Map: ${params.query}`,
          output: `No symbols found in directory "${params.query}".`,
          metadata: { matches: [] }
        }
      }

      const summary = summarizeSymbols(matches, dirPath)
      const output = renderSymbolIndex(matches, dirPath)

      return {
        title: `Architecture Map: ${params.query}`,
        output: `Mapping symbols in ${params.query}:

${output}`,
        metadata: { matches, summary },
      }
    }

    throw new Error(`Unknown action: ${params.action}`)
  },
})
