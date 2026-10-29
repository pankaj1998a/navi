export * as ConfigMedia from "./media"

import { Schema } from "effect"
import { zod } from "@navi-ai/core/effect-zod"
import { PositiveInt, withStatics } from "@navi-ai/core/schema"

export const Image = Schema.Struct({
  auto_resize: Schema.optional(Schema.Boolean),
  max_width: Schema.optional(PositiveInt),
  max_height: Schema.optional(PositiveInt),
  max_base64_bytes: Schema.optional(PositiveInt),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Image = Schema.Schema.Type<typeof Image>

export const Info = Schema.Struct({
  image: Schema.optional(Image),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>
