import z from "zod"
import { Tool } from "./tool"

/**
 * ExaSearchTool — Neural + keyword web search with extraction.
 */
export const ExaSearchTool = Tool.define("exa_search", {
  description: `Search the web using Exa AI. Supports neural or keyword search, date filters, and content extraction (highlights, summaries).`,

  parameters: z.object({
    query: z.string().describe("Search query string."),
    type: z.enum(["auto", "neural", "fast", "deep", "deep-reasoning", "instant"]).optional().default("auto").describe("Exa search mode."),
    count: z.number().min(1).max(100).optional().default(10).describe("Number of results to return."),
    freshness: z.enum(["day", "week", "month", "year"]).optional().describe("Filter by time."),
    include_highlights: z.boolean().optional().default(true).describe("Include highlights."),
    include_summary: z.boolean().optional().default(false).describe("Include summary."),
  }),

  async execute(params, _ctx) {
    const apiKey = process.env.EXA_API_KEY
    if (!apiKey) {
      throw new Error("EXA_API_KEY environment variable is not set.")
    }

    const body: any = {
      query: params.query,
      numResults: params.count,
      type: params.type,
      contents: { 
        highlights: params.include_highlights,
        summary: params.include_summary
      },
    }

    if (params.freshness) {
      const now = new Date()
      if (params.freshness === "day") now.setDate(now.getDate() - 1)
      if (params.freshness === "week") now.setDate(now.getDate() - 7)
      if (params.freshness === "month") now.setMonth(now.getMonth() - 1)
      if (params.freshness === "year") now.setFullYear(now.getFullYear() - 1)
      body.startPublishedDate = now.toISOString()
    }

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Exa API error: ${error}`)
    }

    const data = await response.json() as any

    let output = `Exa Search Results for: ${params.query}\n\n`
    data.results.forEach((result: any, index: number) => {
      output += `${index + 1}. [${result.title || result.url}](${result.url})\n`
      if (result.publishedDate) output += `   Date: ${result.publishedDate}\n`
      if (result.summary) output += `   Summary: ${result.summary}\n`
      if (result.highlights && result.highlights.length > 0) {
        output += `   Highlights:\n      - ${result.highlights.join("\n      - ")}\n`
      }
      output += `\n`
    })

    return {
      title: `Exa Search: ${params.query}`,
      output,
      metadata: { count: data.results.length } as Record<string, any>,
    }
  },
})
