export * as ConfigWarming from "./warming"

import { Schema } from "effect"
import { zod } from "@navi-ai/core/effect-zod"
import { withStatics } from "@navi-ai/core/schema"

export const Info = Schema.Struct({
  prompt: Schema.optional(Schema.String).annotate({
    description: "Prompt sent for keep-alive requests",
  }),
  interval: Schema.optional(Schema.DurationFromString).annotate({
    description: 'Idle time between keep-alive requests (default: "4 minutes")',
  }),
  duration: Schema.optional(Schema.DurationFromString).annotate({
    description: 'Time after the last active request to keep a session warm (default: "30 minutes")',
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export const Warming = Schema.Union([Schema.Boolean, Info]).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Warming = Schema.Schema.Type<typeof Warming>
