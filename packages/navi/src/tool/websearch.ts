import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { executeSearchPipeline, normalizeSearchQuery } from "./search-pipeline"

const DEFAULT_NUM_RESULTS = 8

export const WebSearchTool = Tool.define("websearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Search query to look up on the web"),
    numResults: z
      .number()
      .optional()
      .describe(`Number of search results to return (default: ${DEFAULT_NUM_RESULTS})`),
    type: z
      .enum(["auto", "fast", "deep"])
      .optional()
      .describe("Search depth: auto (default), fast (fewer results), deep (more results)"),
    contextMaxCharacters: z
      .number()
      .optional()
      .describe("Maximum characters in the returned context (default: 10000)"),
    livecrawl: z.enum(["fallback", "preferred"]).optional().describe("Legacy param, ignored"),
  }),
  async execute(params, ctx) {
    const query = normalizeSearchQuery(params.query)

    await ctx.ask({
      permission: "websearch",
      patterns: [query],
      always: ["*"],
      metadata: { query },
    })

    const { CacheManager } = await import("../config/cache-config")
    const cache = CacheManager.getInstance().getCache("webSearch")
    const numResults =
      params.type === "deep" ? 15 : params.type === "fast" ? 4 : (params.numResults ?? DEFAULT_NUM_RESULTS)
    const cacheKey = JSON.stringify({ query, numResults })
    const cached = cache.get(cacheKey)
    if (cached) return cached

    const search = await executeSearchPipeline(query, numResults)
    const results = search.results

    let output: string
    if (results.length === 0) {
      output = `No results found for: "${params.query}"\n\nTip: Install Google Chrome or Microsoft Edge for best results.`
    } else {
      const lines: string[] = [`Search results for: "${params.query}"`, `Provider: ${search.provider}`, ""]
      results.forEach((r, i) => {
        lines.push(`${i + 1}. **${r.title}**`)
        lines.push(`   URL: ${r.url}`)
        if (r.snippet) lines.push(`   ${r.snippet}`)
        lines.push("")
      })
      output = lines.join("\n")
    }

    const maxChars = params.contextMaxCharacters ?? 10_000
    if (output.length > maxChars) output = output.slice(0, maxChars) + "\n…(truncated)"

    const result = {
      output,
      title: `Web search: ${params.query}`,
      metadata: {
        provider: search.provider,
        attemptedProviders: search.attemptedProviders,
        numResults: results.length,
        normalizedQuery: query,
      },
    }
    cache.set(cacheKey, result)
    return result
  },
})
