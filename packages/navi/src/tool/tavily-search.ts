import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { searchService } from "../search/service"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query" }),
  search_depth: Schema.optional(Schema.Literals(["basic", "advanced"])).annotate({
    description: "Search depth (default: basic)",
  }),
  topic: Schema.optional(Schema.Literals(["general", "news", "finance"])).annotate({
    description: "Search topic (default: general)",
  }),
  max_results: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results (default: 8)",
  }),
  include_answer: Schema.optional(Schema.Boolean).annotate({
    description: "Include AI-generated answer (default: false)",
  }),
})

export const TavilySearchTool = Tool.define(
  "tavily_search",
  Effect.gen(function* () {
    return {
      description: "AI-optimized web search via Tavily API.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: { query: params.query, provider: "tavily" },
          })

          const results = yield* Effect.promise(() =>
            searchService.search({ text: params.query, limit: params.max_results ?? 8 }, "tavily"),
          )

          const lines: string[] = [`# Tavily Search Results: "${params.query}"`, ""]
          results.forEach((r, i) => {
            lines.push(`${i + 1}. **${r.title}**`)
            lines.push(`   URL: ${r.url}`)
            if (r.snippet) lines.push(`   ${r.snippet}`)
            lines.push("")
          })

          return {
            output: lines.join("\n"),
            title: `Tavily: ${params.query}`,
            metadata: {
              query: params.query,
              numResults: results.length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
