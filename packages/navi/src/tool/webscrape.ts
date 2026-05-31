import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { webScrape, autoScrape } from "./browser-engine"

export const ScrapeField = Schema.Struct({
  name: Schema.String.annotate({ description: "Field name for the extracted data" }),
  selector: Schema.String.annotate({ description: "CSS selector to target the element(s)" }),
  attribute: Schema.optional(Schema.String).annotate({
    description: "HTML attribute to extract (e.g. 'href', 'src', 'data-id'). Defaults to inner text.",
  }),
  multiple: Schema.optional(Schema.Boolean).annotate({
    description: "Extract all matching elements (returns array) instead of just the first",
  }),
})

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "URL of the page to scrape" }),
  mode: Schema.Literals(["auto", "custom"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("auto" as const)))
    .annotate({
      description: "'auto' extracts common page data automatically. 'custom' requires you to provide fields with CSS selectors.",
    }),
  fields: Schema.optional(Schema.Array(ScrapeField)).annotate({
    description: "Required when mode is 'custom'. List of fields to extract with CSS selectors.",
  }),
})

export const WebScrapeTool = Tool.define(
  "webscrape",
  Effect.gen(function* () {
    return {
      description: "Scrape structured data from a web page using CSS selectors, or auto-extract common page data.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: { url: params.url, mode: params.mode },
          })

          let result: any
          try {
            if (params.mode === "custom") {
              if (!params.fields || params.fields.length === 0) {
                throw new Error("'custom' mode requires at least one field with a CSS selector.")
              }
              result = yield* Effect.promise(() => webScrape(params.url, params.fields! as any))
            } else {
              result = yield* Effect.promise(() => autoScrape(params.url))
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            throw new Error(`Scrape failed for ${params.url}: ${msg}`)
          }

          const data = result?.data || {}
          const lines: string[] = [`# Scraped Data: ${params.url}`, ""]
          for (const [key, value] of Object.entries(data)) {
            if (Array.isArray(value)) {
              if (value.length === 0) continue
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

          return {
            output: lines.join("\n"),
            title: `Scraped: ${params.url}`,
            metadata: {
              url: params.url,
              mode: params.mode,
              fields: Object.keys(data),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
