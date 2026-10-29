export * as ConfigWorktree from "./worktree"

import { Schema } from "effect"
import { zod } from "@navi-ai/core/effect-zod"
import { withStatics } from "@navi-ai/core/schema"

export const Info = Schema.Struct({
  directory: Schema.Trim.pipe(Schema.check(Schema.isNonEmpty())).annotate({
    description: "Parent directory for new worktrees, relative to the project's primary checkout when not absolute",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>
