import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { executeSearchPipeline, normalizeSearchQuery } from "./search-pipeline"
import { summarizeWithGoogleAi } from "./google-search-summarizer"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of search results to include (default: 8)",
  }),
})

export interface GoogleSearchMetadata {
  provider: string
  attemptedProviders: any[]
  normalizedQuery: string
  aiMode?: "gemini" | "heuristic"
  numResults: number
}

export const GoogleSearchTool = Tool.define<typeof Parameters, GoogleSearchMetadata, never>(
  "googlesearch",
  Effect.gen(function* () {
    return {
      description: "Google-style AI search. Searches the web and provides a synthesized AI summary of the results.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const query = normalizeSearchQuery(params.query)
          const numResults = Math.min(Math.max(params.numResults ?? 8, 1), 15)

          yield* ctx.ask({
            permission: "websearch",
            patterns: [query],
            always: ["*"],
            metadata: { query, provider: "google-ai" },
          })

          const search = yield* Effect.promise(() =>
            executeSearchPipeline(query, numResults, ["google", "browser", "bing", "duckduckgo"]),
          )
          const searchResults = search.results

          if (searchResults.length === 0) {
            return {
              output: `No results found for: "${params.query}"`,
              title: `Google AI Search: ${params.query}`,
                metadata: {
                  provider: "none",
                  attemptedProviders: search.attemptedProviders,
                  normalizedQuery: query,
                  aiMode: undefined,
                  numResults: 0,
                },
            }
          }

          const aiSummary = yield* Effect.promise(() => summarizeWithGoogleAi(query, searchResults, ctx.abort))

          const lines: string[] = [
            `Google-style search results for: "${params.query}"`,
            `Search provider: ${search.provider}`,
            `AI synthesis: ${aiSummary.mode}`,
            "",
            "Summary:",
            aiSummary.summary,
            "",
            "Results:",
            "",
          ]
          searchResults.forEach((r, i) => {
            lines.push(`${i + 1}. **${r.title}**`)
            lines.push(`   URL: ${r.url}`)
            if (r.snippet) lines.push(`   ${r.snippet}`)
            lines.push("")
          })

          return {
            output: lines.join("\n"),
            title: `Google AI Search: ${params.query}`,
            metadata: {
              provider: search.provider,
              attemptedProviders: search.attemptedProviders,
              aiMode: aiSummary.mode,
              numResults: searchResults.length,
              normalizedQuery: query,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
