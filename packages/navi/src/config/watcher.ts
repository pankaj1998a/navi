export * as ConfigWatcher from "./watcher"

import { Schema } from "effect"
import { zod } from "@navi-ai/core/effect-zod"
import { withStatics } from "@navi-ai/core/schema"

export const Info = Schema.Struct({
  ignore: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>
