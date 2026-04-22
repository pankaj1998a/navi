import z from "zod"
import { Tool } from "./tool"

/**
 * TavilySearchTool — AI-optimized web search.
 */
export const TavilySearchTool = Tool.define("tavily_search", {
  description: `Search the web using Tavily Search API. Optimized for AI insights.
Supports search depth (basic/advanced), topic filtering (news/finance/general), and AI answers.`,

  parameters: z.object({
    query: z.string().describe("Search query string."),
    search_depth: z.enum(["basic", "advanced"]).optional().default("basic").describe("Search depth."),
    topic: z.enum(["general", "news", "finance"]).optional().default("general").describe("Search topic."),
    max_results: z.number().min(1).max(20).optional().default(5).describe("Number of results to return."),
    include_answer: z.boolean().optional().default(false).describe("Include AI answer summary."),
  }),

  async execute(params, _ctx) {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      throw new Error("TAVILY_API_KEY environment variable is not set.")
    }

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: params.query,
        search_depth: params.search_depth,
        topic: params.topic,
        max_results: params.max_results,
        include_answer: params.include_answer,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Tavily API error: ${error}`)
    }

    const data = await response.json() as any

    let output = `Tavily Search Results for: ${params.query}\n\n`
    if (data.answer) {
      output += `**Answer**: ${data.answer}\n\n`
    }

    data.results.forEach((result: any, index: number) => {
      output += `${index + 1}. [${result.title}](${result.url})\n`
      output += `   ${result.content.substring(0, 300)}...\n\n`
    })

    return {
      title: `Tavily Search: ${params.query}`,
      output,
      metadata: { resultsCount: data.results.length },
    }
  },
})
