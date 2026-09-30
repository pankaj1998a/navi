import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { webCrawl } from "./browser-engine"

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "URL to start crawling from" }),
  maxPages: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of pages to crawl (default 10, max 50)",
  }),
  maxDepth: Schema.optional(Schema.Number).annotate({
    description: "Maximum depth of links to follow (default 2)",
  }),
  sameDomain: Schema.optional(Schema.Boolean).annotate({
    description: "Only follow links on the same domain as the start URL (default true)",
  }),
  format: Schema.Literals(["text", "markdown", "html"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const)))
    .annotate({ description: "Output format for each page" }),
  includePattern: Schema.optional(Schema.String).annotate({
    description: "Only crawl URLs matching this regex pattern",
  }),
  excludePattern: Schema.optional(Schema.String).annotate({
    description: "Skip URLs matching this regex pattern",
  }),
})

export const WebCrawlTool = Tool.define(
  "webcrawl",
  Effect.gen(function* () {
    return {
      description: "Crawl a website starting from a URL, following links up to a specified depth.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: { url: params.url, maxPages: params.maxPages },
          })

          const opts = {
            maxPages: Math.min(params.maxPages ?? 10, 50),
            maxDepth: params.maxDepth ?? 2,
            sameDomain: params.sameDomain ?? true,
            format: params.format,
            includePattern: params.includePattern ? new RegExp(params.includePattern) : undefined,
            excludePattern: params.excludePattern ? new RegExp(params.excludePattern) : undefined,
          }

          const _pages = yield* Effect.promise(() => webCrawl(params.url, opts as any))
          const pages = Array.isArray(_pages) ? _pages : []

          const lines: string[] = [`# Crawl Results: ${params.url}`, ""]
          lines.push(`Found ${pages.length} pages.`, "")

          for (const page of pages) {
            lines.push(`## ${page.title || page.url}`)
            lines.push(`URL: ${page.url}`)
            lines.push(`Depth: ${page.depth}`)
            lines.push("")
            lines.push(page.content.slice(0, 2000))
            if (page.content.length > 2000) lines.push("…(truncated)")
            lines.push("")
            lines.push("---")
            lines.push("")
          }

          return {
            output: lines.join("\n"),
            title: `Crawled: ${params.url}`,
            metadata: {
              url: params.url,
              pagesFound: pages.length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
