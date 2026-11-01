import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import { Env } from "../env"
import * as McpWebSearch from "./mcp-websearch"
import { assertAllowed, guardedFetch, resolvePolicy } from "./net-guard"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query string." }),
  type: Schema.optional(Schema.Literals(["auto", "neural", "fast", "deep", "deep-reasoning", "instant"]))
    .pipe(Schema.withDecodingDefault(Effect.succeed("auto" as const)))
    .annotate({ description: "Exa search mode." }),
  count: Schema.optional(Schema.Number).annotate({
    description: "Number of results to return (default 10, max 100).",
  }),
  freshness: Schema.optional(Schema.Literals(["day", "week", "month", "year"])).annotate({
    description: "Filter by time.",
  }),
  include_highlights: Schema.optional(Schema.Boolean).annotate({
    description: "Include highlights (default true).",
  }),
  include_summary: Schema.optional(Schema.Boolean).annotate({
    description: "Include summary (default false).",
  }),
})

interface ExaSearchResult {
  title?: string
  url?: string
  publishedDate?: string
  summary?: string
  highlights?: string[]
}

interface ExaSearchResponse {
  results?: ExaSearchResult[]
}

export const ExaSearchTool = Tool.define(
  "exa_search",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      description: "Search the web using Exa AI. Supports neural or keyword search, date filters, and content extraction.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const apiKey = yield* Effect.promise(() => Env.get("EXA_API_KEY"))

          // Both backends (MCP bridge and direct API) must be allowed by the
          // egress policy before anything is requested.
          const policy = yield* resolvePolicy()

          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: { query: params.query, provider: "exa" },
          })

          // If no API key is provided, fall back to the MCP bridge used in opencode
          if (!apiKey) {
            const result = yield* McpWebSearch.call(
              http,
              McpWebSearch.EXA_URL,
              "web_search_exa",
              McpWebSearch.SearchArgs,
              {
                query: params.query,
                type: params.type === "neural" ? "auto" : (params.type || "auto"),
                numResults: params.count || 10,
                livecrawl: "fallback",
              },
              "25 seconds",
              undefined,
              { policy },
            )

            return {
              output: result ?? "No search results found.",
              title: `Exa (via Bridge): ${params.query}`,
              metadata: { count: result ? 1 : 0 },
            }
          }

          const endpoint = "https://api.exa.ai/search"
          assertAllowed(endpoint, policy)

          // Direct API call if API key is present (supports more features)
          const body = {
            query: params.query,
            numResults: params.count ?? 10,
            type: params.type,
            contents: {
              highlights: params.include_highlights ?? true,
              summary: params.include_summary ?? false,
            },
          } as {
            query: string
            numResults: number
            type?: string
            contents: { highlights: boolean; summary: boolean }
            startPublishedDate?: string
          }

          if (params.freshness) {
            const now = new Date()
            if (params.freshness === "day") now.setDate(now.getDate() - 1)
            if (params.freshness === "week") now.setDate(now.getDate() - 7)
            if (params.freshness === "month") now.setMonth(now.getMonth() - 1)
            if (params.freshness === "year") now.setFullYear(now.getFullYear() - 1)
            body.startPublishedDate = now.toISOString()
          }

          const response = yield* Effect.promise(() =>
            guardedFetch(endpoint, {
              policy,
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": apiKey },
              body: JSON.stringify(body),
            }),
          )

          if (!response.ok) {
            const error = yield* Effect.promise(() => response.text())
            throw new Error(`Exa API error: ${error}`)
          }

          const data = (yield* Effect.promise(() => response.json())) as ExaSearchResponse
          const results = data.results || []

          let output = `# Exa Search Results: ${params.query}\n\n`
          results.forEach((result, index) => {
            output += `${index + 1}. [${result.title || result.url}](${result.url})\n`
            if (result.publishedDate) output += `   Date: ${result.publishedDate}\n`
            if (result.summary) output += `   Summary: ${result.summary}\n`
            if (result.highlights && result.highlights.length > 0) {
              output += `   Highlights:\n      - ${result.highlights.join("\n      - ")}\n`
            }
            output += `\n`
          })

          return {
            output,
            title: `Exa: ${params.query}`,
            metadata: { count: results.length },
          }
        }).pipe(Effect.orDie) as any,
    }
  }),
)
