import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./webfetch.txt"
import { webFetch } from "./browser-engine"

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in. Defaults to markdown."),
    timeout: z.number().optional().describe("Optional timeout in seconds (max 120, default 30)"),
    javascript: z
      .boolean()
      .optional()
      .describe(
        "Force browser rendering to handle JavaScript-heavy pages (default: auto-detected). Set true for SPAs or dynamic content.",
      ),
  }),
  async execute(params, ctx) {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    // Convert GitHub blob URL to raw URL for better fetching
    if (params.url.includes("github.com") && params.url.includes("/blob/")) {
      params.url = params.url.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/")
      // Force text format for raw code to avoid markdown parsing issues
      if (params.format === "markdown") {
        params.format = "text"
      }
    }

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, format: params.format },
    })

    const { CacheManager } = await import("../config/cache-config")
    const cache = CacheManager.getInstance().getCache("webFetch")
    const cacheKey = JSON.stringify({
      url: params.url,
      format: params.format,
      javascript: params.javascript === true,
    })
    const cached = cache.get(cacheKey)
    if (cached) return cached

    const timeoutMs = Math.min((params.timeout ?? 30) * 1000, 120_000)

    let output: string
    let title: string
    try {
      const fetched = await webFetch(params.url, params.format ?? "markdown", timeoutMs, {
        preferBrowser: params.javascript === true,
      })
      output = fetched.content
      title = fetched.title || params.url
      ctx.metadata({
        title: `${title} (${params.url})`,
        metadata: {
          url: params.url,
          format: params.format ?? "markdown",
          javascript: params.javascript ?? false,
          statusCode: fetched.statusCode,
        },
      })
    } catch (err) {
      // Fallback: try plain HTTP fetch without browser engine
      try {
        const { htmlToMarkdown, htmlToText } = await import("./browser-engine")
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const response = await fetch(params.url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,*/*",
          },
        })
        clearTimeout(timer)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const html = await response.text()
        const format = params.format ?? "markdown"
        if (format === "html") {
          output = html
        } else if (format === "text") {
          output = htmlToText(html)
        } else {
          output = htmlToMarkdown(html)
        }
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
        title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : params.url
      } catch (fallbackErr) {
        const msg = err instanceof Error ? err.message : String(err)
        const msg2 = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
        throw new Error(`Failed to fetch ${params.url}: ${msg} (HTTP fallback also failed: ${msg2})`)
      }
    }

    // Trim to reasonable size
    const MAX = 100_000
    if (output.length > MAX) output = output.slice(0, MAX) + "\n…(content truncated at 100 KB)"

    const result = {
      output,
      title: `${title} (${params.url})`,
      metadata: {
        url: params.url,
        format: params.format ?? "markdown",
        javascript: params.javascript ?? false,
      },
    }
    cache.set(cacheKey, result)
    return result
  },
})
