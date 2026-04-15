import z from "zod"
import { Tool } from "./tool"
import { webScrape, autoScrape } from "./browser-engine"

const ScrapeFieldSchema = z.object({
    name: z.string().describe("Field name for the extracted data"),
    selector: z.string().describe("CSS selector to target the element(s)"),
    attribute: z
        .string()
        .optional()
        .describe("HTML attribute to extract (e.g. 'href', 'src', 'data-id'). Defaults to inner text."),
    multiple: z
        .boolean()
        .optional()
        .describe("Extract all matching elements (returns array) instead of just the first"),
})

export const WebScrapeTool = Tool.define("webscrape", {
    description: `Scrape structured data from a web page using CSS selectors, or auto-extract common page data.

Use this when you need to:
- Extract specific fields from a product page, article, or listing
- Pull tabular data from HTML tables
- Gather prices, titles, links, images or any structured content
- Collect data from multiple elements on a page

Two modes:
1. **auto** (no fields required): Automatically extracts title, description, headings, paragraphs, links, images, tables, and main content
2. **custom fields**: Provide CSS selectors for precise, structured extraction`,
    parameters: z.object({
        url: z.string().describe("URL of the page to scrape"),
        mode: z
            .enum(["auto", "custom"])
            .default("auto")
            .describe("'auto' extracts common page data automatically. 'custom' requires you to provide fields with CSS selectors."),
        fields: z
            .array(ScrapeFieldSchema)
            .optional()
            .describe("Required when mode is 'custom'. List of fields to extract with CSS selectors."),
    }),
    async execute(params, ctx) {
        if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
        }

        await ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: { url: params.url, mode: params.mode },
        })

        let result
        try {
            if (params.mode === "custom") {
                if (!params.fields || params.fields.length === 0) {
                    throw new Error("'custom' mode requires at least one field with a CSS selector.")
                }
                result = await webScrape(params.url, params.fields)
            } else {
                result = await autoScrape(params.url)
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            throw new Error(`Scrape failed for ${params.url}: ${msg}`)
        }

        // Format the output as readable markdown
        const lines: string[] = [`# Scraped Data: ${params.url}`, ""]

        for (const [key, value] of Object.entries(result.data)) {
            if (Array.isArray(value)) {
                if (value.length === 0) continue
                // Check if it's an array of objects (links, images, tables)
                if (typeof value[0] === "object" && value[0] !== null) {
                    lines.push(`## ${key}`)
                    lines.push("```json")
                    lines.push(JSON.stringify(value, null, 2).slice(0, 5000))
                    lines.push("```")
                } else {
                    lines.push(`## ${key}`)
                    value.slice(0, 50).forEach((v, i) => lines.push(`${i + 1}. ${v}`))
                }
            } else if (typeof value === "string" && value.length > 0) {
                lines.push(`## ${key}`)
                lines.push(value.slice(0, 3000))
                if (value.length > 3000) lines.push("…(truncated)")
            }
            lines.push("")
        }

        const output = lines.join("\n")

        return {
            output,
            title: `Scraped: ${params.url}`,
            metadata: {
                url: params.url,
                mode: params.mode,
                fields: Object.keys(result.data),
            },
        }
    },
})


