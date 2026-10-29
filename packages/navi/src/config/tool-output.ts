export * as ConfigToolOutput from "./tool-output"

import { Schema } from "effect"
import { zod } from "@navi-ai/core/effect-zod"
import { PositiveInt, withStatics } from "@navi-ai/core/schema"

export const Info = Schema.Struct({
  max_lines: Schema.optional(PositiveInt).annotate({
    description: "Maximum lines of tool output before it is truncated and saved to disk (default: 2000)",
  }),
  max_bytes: Schema.optional(PositiveInt).annotate({
    description: "Maximum bytes of tool output before it is truncated and saved to disk (default: 51200)",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>
