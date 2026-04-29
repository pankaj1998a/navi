import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { abortAfterAny } from "../util/abort"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
} as const

interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: "fallback" | "preferred"
      type?: "auto" | "fast" | "deep"
      contextMaxCharacters?: number
    }
  }
}

interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

import { searchService } from "../search/service"

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
      provider: z.enum(["google", "bing", "duckduckgo", "exa", "tavily", "firecrawl", "browser"]).optional().describe("Override default search provider"),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
          provider: params.provider,
        },
      })

      const results = await searchService.search({
        text: params.query,
        limit: params.numResults,
      }, params.provider as any)

      if (results.length === 0) {
        return {
          output: "No search results found. Please try a different query.",
          title: `Web search: ${params.query}`,
          metadata: { count: 0, provider: params.provider || "default" },
        }
      }

      const output = results.map((r, i) => {
        let entry = `${i + 1}. [${r.title}](${r.url})\n`
        if (r.snippet) entry += `   ${r.snippet}\n`
        return entry
      }).join("\n")

      return {
        output,
        title: `Web search: ${params.query}`,
        metadata: {
          count: results.length,
          provider: params.provider || "default"
        },
      }
    },
  }
})

