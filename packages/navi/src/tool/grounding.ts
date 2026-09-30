import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { searchService } from "../search/service"

export const Parameters = Schema.Struct({
  claim: Schema.String.annotate({ description: "The factual claim or statement to verify" }),
})

export const GroundingTool = Tool.define(
  "grounding",
  Effect.gen(function* () {
    return {
      description: "Verify a claim or factual statement by searching the web. Returns supporting or contradicting results.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.claim],
            always: ["*"],
            metadata: { claim: params.claim },
          })

          const results = yield* Effect.promise(() => searchService.search({ text: params.claim, limit: 5 }))

          const lines: string[] = [`# Grounding results for: "${params.claim}"`, ""]
          if (results.length === 0) {
            lines.push("No relevant information found on the web to verify this claim.")
          } else {
            lines.push("Found the following sources:")
            results.forEach((r, i) => {
              lines.push(`${i + 1}. **${r.title}**`)
              lines.push(`   URL: ${r.url}`)
              if (r.snippet) lines.push(`   Snippet: ${r.snippet}`)
              lines.push("")
            })
          }

          return {
            output: lines.join("\n"),
            title: `Grounding: ${params.claim}`,
            metadata: {
              claim: params.claim,
              resultsFound: results.length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
