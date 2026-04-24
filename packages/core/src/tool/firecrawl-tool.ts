import z from "zod"
import { Tool } from "./tool"

/**
 * FirecrawlTool — Web scraping and crawling for agent-ready Markdown.
 */
export const FirecrawlTool = Tool.define("firecrawl", {
  description: `Scrape or crawl websites using Firecrawl into agent-friendly Markdown. 
Ideal for complex, JS-heavy web pages that standard fetching might miss.`,

  parameters: z.object({
    action: z.enum(["scrape", "crawl"]).describe("Action to perform."),
    url: z.string().describe("Target URL."),
  }),

  async execute(params, _ctx) {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY environment variable is not set.")
    }

    const endpoint = params.action === "scrape" 
      ? "https://api.firecrawl.dev/v1/scrape" 
      : "https://api.firecrawl.dev/v1/crawl"

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: params.url, formats: ["markdown"] }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Firecrawl API error: ${errorText}`)
    }

    const data = await response.json() as any
    
    if (params.action === "scrape") {
      const result = data.data
      return {
        title: `Firecrawl Scrape: ${params.url}`,
        output: result.markdown || "No markdown content returned.",
        metadata: { url: params.url, jobId: undefined } as Record<string, any>,
      }
    } else {
      return {
        title: `Firecrawl Crawl Started`,
        output: `Crawl job started for ${params.url}. Job ID: ${data.id}`,
        metadata: { url: params.url, jobId: data.id } as Record<string, any>,
      }
    }
  },
})
