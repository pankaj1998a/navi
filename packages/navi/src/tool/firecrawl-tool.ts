import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Env } from "../env"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["scrape", "crawl", "search"]),
  url: Schema.optional(Schema.String).annotate({ description: "URL to scrape or crawl" }),
  query: Schema.optional(Schema.String).annotate({ description: "Search query" }),
})

export const FirecrawlTool = Tool.define(
  "firecrawl",
  Effect.gen(function* () {
    return {
      description: "Scrape, crawl, or search websites using Firecrawl into agent-friendly Markdown.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const apiKey = yield* Effect.promise(() => Env.get("FIRECRAWL_API_KEY"))
          if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set")

          const permissionUrl = params.url || params.query || "firecrawl"
          yield* ctx.ask({
            permission: "webfetch",
            patterns: [permissionUrl],
            always: ["*"],
            metadata: { action: params.action, input: permissionUrl },
          })

          const res = yield* Effect.promise(() =>
            fetch(`https://api.firecrawl.dev/v1/${params.action}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify(
                params.action === "search" ? { query: params.query, limit: 8 } : { url: params.url },
              ),
            }),
          )

          if (!res.ok) throw new Error(`Firecrawl API error: ${yield* Effect.promise(() => res.text())}`)
          const data = yield* Effect.promise(() => res.json()) as any
          const searchResults = data.data || []

          let output = ""
          if (params.action === "search") {
            output = searchResults
              .map((r: any, i: number) => `${i + 1}. **${r.title}**\nURL: ${r.url}\n${r.description}\n`)
              .join("\n")
          } else {
            output = data.data?.markdown || data.markdown || JSON.stringify(data, null, 2)
          }

          return {
            output: output || "No content returned from Firecrawl.",
            title: `Firecrawl ${params.action}: ${permissionUrl}`,
            metadata: { action: params.action },
          }
        }).pipe(Effect.orDie) as any,
    }
  }),
)
