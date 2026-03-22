import z from "zod"
import { Tool } from "./tool"
import { webCrawl } from "./browser-engine"

export const WebCrawlTool = Tool.define("webcrawl", {
    description: `Crawl a website starting from a given URL, following links up to a specified depth.
Returns multiple pages with their content, useful for understanding an entire site or section.

Use this when you need to:
- Understand the structure of a website
- Gather content from multiple related pages
- Index documentation or help sites
- Research a topic across many pages of a domain`,
    parameters: z.object({
        url: z.string().describe("Starting URL to crawl from"),
        maxPages: z
            .number()
            .optional()
            .describe("Maximum number of pages to crawl (default: 10, max: 50)"),
        maxDepth: z
            .number()
            .optional()
            .describe("Maximum link-follow depth from the start URL (default: 2)"),
        sameDomain: z
            .boolean()
            .optional()
            .describe("Only follow links on the same domain as the start URL (default: true)"),
        format: z
            .enum(["markdown", "text", "html"])
            .optional()
            .describe("Content format for each crawled page (default: markdown)"),
        includePattern: z
            .string()
            .optional()
            .describe("Only crawl URLs matching this regex pattern (e.g. '/docs/'  to crawl only the docs section)"),
        excludePattern: z
            .string()
            .optional()
            .describe("Skip URLs matching this regex pattern (e.g. '/blog/' to skip blog posts)"),
    }),
    async execute(params, ctx) {
        if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
        }

        await ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: { url: params.url, maxPages: params.maxPages, maxDepth: params.maxDepth },
        })

        const maxPages = Math.min(params.maxPages ?? 10, 50)
        const maxDepth = Math.min(params.maxDepth ?? 2, 5)

        let pages
        try {
            pages = await webCrawl(params.url, {
                maxPages,
                maxDepth,
                sameDomain: params.sameDomain ?? true,
                format: (params.format ?? "markdown") as "markdown" | "text" | "html",
                includePattern: params.includePattern ? new RegExp(params.includePattern) : undefined,
                excludePattern: params.excludePattern ? new RegExp(params.excludePattern) : undefined,
            })
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            throw new Error(`Crawl failed: ${msg}`)
        }

        if (pages.length === 0) {
            return {
                output: `No pages were crawled from ${params.url}. The site may block crawlers or require JavaScript.`,
                title: `Crawl: ${params.url}`,
                metadata: { pageCount: 0 } as Record<string, unknown>,
            }
        }

        const sections: string[] = [`# Crawl Results: ${params.url}`, `Pages crawled: ${pages.length}`, ""]

        for (const page of pages) {
            sections.push(`---`)
            sections.push(`## [${page.title || page.url}](${page.url})`)
            sections.push(`Depth: ${page.depth} | Links found: ${page.links.length}`)
            sections.push("")
            // Limit per-page content to be manageable
            const content = page.content.slice(0, 4000)
            sections.push(content)
            if (page.content.length > 4000) sections.push("…(page truncated)")
            sections.push("")
        }

        const output = sections.join("\n")

        return {
            output,
            title: `Crawl: ${params.url} (${pages.length} pages)`,
            metadata: {
                pageCount: pages.length,
                pages: pages.map((p) => ({ url: p.url, title: p.title, depth: p.depth, linkCount: p.links.length })),
            } as Record<string, unknown>,
        }
    },
})
