import { Schema } from "effect"
import { Effect } from "effect"
import * as Tool from "./tool"
import { retrieveCcr, normalizeCcrKey } from "../compress/headroom"

export const Parameters = Schema.Struct({
  key: Schema.String.annotate({
    description: "The 24-character CCR content hash marker (e.g. from <<ccr:abcdef123456...>>)",
  }),
})

export const HeadroomRetrieveTool = Tool.define(
  "headroom_retrieve",
  Effect.gen(function* () {
    return {
      description:
        "Retrieve full, uncompressed original text of a snippet marked with <<ccr:key>> (lossless context recovery).",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult> =>
        Effect.gen(function* () {
          const cleanKey = normalizeCcrKey(params.key)
          const content = retrieveCcr(cleanKey)

          if (!content) {
            return {
              title: "headroom_retrieve",
              output: `[Error] No cached content found in CCR store for key: "${cleanKey}".`,
              metadata: {},
            }
          }

          return {
            title: "headroom_retrieve",
            output: content,
            metadata: {},
          }
        }),
    }
  }),
)
