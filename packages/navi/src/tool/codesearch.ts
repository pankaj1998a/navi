import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./codesearch.txt"
import { Log } from "../util/log"

const log = Log.create({ service: "codesearch-tool" })

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    CONTEXT: "/mcp",
  },
} as const

interface McpCodeRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      tokensNum: number
    }
  }
}

interface McpCodeResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

/**
 * Fallback: search for code context using DuckDuckGo
 */
async function fallbackCodeSearch(query: string): Promise<string | null> {
  const searchQuery = `${query} site:github.com OR site:stackoverflow.com OR site:developer.mozilla.org`
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html",
      },
    })
    clearTimeout(timer)

    if (!response.ok) return null

    const html = await response.text()
    const results: string[] = []

    const resultBlocks = html.split(/class="result\s/)
    for (let i = 1; i < resultBlocks.length && results.length < 5; i++) {
      const block = resultBlocks[i]
      const urlMatch = block.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)/) ||
        block.match(/href="(https?:\/\/[^"]+)"/)
      const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</)
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//)

      if (urlMatch && titleMatch) {
        let href = urlMatch[1]
        try { href = decodeURIComponent(href) } catch { }
        if (!href.startsWith("http")) continue

        const title = titleMatch[1].replace(/<[^>]+>/g, "").trim()
        const snippet = snippetMatch
          ? snippetMatch[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()
          : ""

        results.push(`**${title}**\nURL: ${href}\n${snippet}`)
      }
    }

    if (results.length === 0) return null
    return `Code search results (via web search fallback):\n\n${results.join("\n\n")}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

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
  async execute(params, ctx): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
    await ctx.ask({
      permission: "codesearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        tokensNum: params.tokensNum,
      },
    })

    // Try Exa API first
    try {
      const codeRequest: McpCodeRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_code_context_exa",
          arguments: {
            query: params.query,
            tokensNum: params.tokensNum || 5000,
          },
        },
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      const headers: Record<string, string> = {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
        method: "POST",
        headers,
        body: JSON.stringify(codeRequest),
        signal: AbortSignal.any([controller.signal, ctx.abort]),
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Exa API error (${response.status})`)
      }

      const responseText = await response.text()

      // Parse SSE response
      const lines = responseText.split("\n")
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data: McpCodeResponse = JSON.parse(line.substring(6))
          if (data.result && data.result.content && data.result.content.length > 0) {
            return {
              output: data.result.content[0].text,
              title: `Code search: ${params.query}`,
              metadata: {} as Record<string, unknown>,
            }
          }
        }
      }

      throw new Error("No results from Exa API")
    } catch (exaError) {
      // Exa failed — try web search fallback
      log.warn("Exa API failed, trying web search fallback", { error: String(exaError) })

      try {
        const fallbackResult = await fallbackCodeSearch(params.query)
        if (fallbackResult) {
          return {
            output: fallbackResult,
            title: `Code search: ${params.query}`,
            metadata: { source: "web-fallback" } as Record<string, unknown>,
          }
        }
      } catch (fallbackErr) {
        log.warn("Code search fallback also failed", { error: String(fallbackErr) })
      }

      // If Exa returned AbortError, re-throw
      if (exaError instanceof Error && exaError.name === "AbortError") {
        throw new Error("Code search request timed out")
      }

      return {
        output:
          "Code search is currently unavailable. The Exa API could not be reached and the web fallback returned no results.\n\n" +
          "You can try:\n" +
          "1. Search manually using the websearch tool\n" +
          "2. Check the Exa API status at https://exa.ai\n" +
          `3. Try a different query\n\nOriginal error: ${exaError instanceof Error ? exaError.message : String(exaError)}`,
        title: `Code search: ${params.query}`,
        metadata: { error: true } as Record<string, unknown>,
      }
    }
  },
})
