import z from "zod"
import { Tool } from "./tool"

/**
 * DuckDuckGoSearchTool — Free web search without API keys.
 */
export const DuckDuckGoSearchTool = Tool.define("duckduckgo_search", {
  description: `Search the web using DuckDuckGo. No API key required. 
Best for simple queries and getting instant answers without external dependencies.`,

  parameters: z.object({
    query: z.string().describe("Search query string."),
    max_results: z.number().min(1).max(10).optional().default(5).describe("Number of results to return."),
  }),

  async execute(params, _ctx) {
    const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(params.query)}&format=json&no_html=1&skip_disambig=1`)
    
    if (!response.ok) {
      throw new Error(`DuckDuckGo API error: ${response.statusText}`)
    }

    const data = await response.json() as any
    let output = `DuckDuckGo Results for: ${params.query}\n\n`
    
    if (data.AbstractText) {
      output += `**Abstract**: ${data.AbstractText}\nSource: ${data.AbstractURL}\n\n`
    }
    
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      output += `Related Topics:\n`
      data.RelatedTopics.slice(0, params.max_results).forEach((topic: any, index: number) => {
        if (topic.Text) {
          output += `${index + 1}. [${topic.Text}](${topic.FirstURL})\n`
        }
      })
    }

    return {
      title: `DDG Search: ${params.query}`,
      output: output.length < 50 ? output + "No results found via Instant Answer API." : output,
      metadata: {},
    }
  },
})
