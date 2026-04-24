import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./codesearch.txt"
import { executeSearchPipeline } from "./search-pipeline"

export const CodeSearchTool = Tool.define("codesearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
      ),
    tokensNum: z
      .number()
      .min(1000)
      .max(50000)
      .default(5000)
      .describe(
        "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
      ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "codesearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        tokensNum: params.tokensNum,
      },
    })

    const query = params.query + " documentation OR github OR examples"
    const search = await executeSearchPipeline(query, 10, ["google", "duckduckgo", "browser"])

    if (search.results.length === 0) {
      return {
        output:
          "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
        title: `Code search: ${params.query}`,
        metadata: { provider: search.provider } as Record<string, any>,
      }
    }

    const lines: string[] = [
        `Code search results for: "${params.query}"`,
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
        title: `Code search: ${params.query}`,
        metadata: { provider: search.provider } as Record<string, any>,
    }
  },
})
