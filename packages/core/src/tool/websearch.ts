import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { executeSearchPipeline, normalizeSearchQuery } from "./search-pipeline"

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
        },
      })

      const query = normalizeSearchQuery(params.query)
      const numResults = params.numResults || 8
      const search = await executeSearchPipeline(query, numResults)

      if (search.results.length === 0) {
        return {
          output: "No search results found. Please try a different query.",
          title: `Web search: ${params.query}`,
          metadata: { provider: search.provider } as Record<string, unknown>,
        }
      }

      const lines: string[] = [
          `Web search results for: "${params.query}"`,
          `Provider: ${search.provider}`,
          "",
      ]
      search.results.forEach((r, i) => {
          lines.push(`${i + 1}. **${r.title}**`)
          lines.push(`   URL: ${r.url}`)
          if (r.snippet) lines.push(`   ${r.snippet}`)
          lines.push("")
      })

      return {
          output: lines.join("\n"),
          title: `Web search: ${params.query}`,
          metadata: { provider: search.provider } as Record<string, unknown>,
      }
    },
  }
})
