import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query string." }),
  max_results: Schema.optional(Schema.Number).annotate({
    description: "Number of results to return (default 5, max 10).",
  }),
})

export const DuckDuckGoSearchTool = Tool.define(
  "duckduckgo_search",
  Effect.gen(function* () {
    return {
      description: "Search the web using DuckDuckGo. No API key required. Best for simple queries and getting instant answers.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: { query: params.query, provider: "duckduckgo" },
          })

          const response = yield* Effect.promise(() =>
            fetch(
              `https://api.duckduckgo.com/?q=${encodeURIComponent(params.query)}&format=json&no_html=1&skip_disambig=1`,
            ),
          )

          if (!response.ok) {
            throw new Error(`DuckDuckGo API error: ${response.statusText}`)
          }

          const data = (yield* Effect.promise(() => response.json())) as any
          let output = `# DuckDuckGo Results for: ${params.query}\n\n`

          if (data.AbstractText) {
            output += `**Abstract**: ${data.AbstractText}\nSource: ${data.AbstractURL}\n\n`
          }

          if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            output += `Related Topics:\n`
            data.RelatedTopics.slice(0, params.max_results ?? 5).forEach((topic: any, index: number) => {
              if (topic.Text) {
                output += `${index + 1}. [${topic.Text}](${topic.FirstURL})\n`
              }
            })
          }

          return {
            output: output.length < 50 ? output + "No results found via Instant Answer API." : output,
            title: `DDG Search: ${params.query}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
