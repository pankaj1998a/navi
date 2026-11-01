export * as ConfigPermission from "./permission"
import { Schema, SchemaGetter } from "effect"
import { zod } from "@navi-ai/core/effect-zod"
import { withStatics } from "@navi-ai/core/schema"

export const Action = Schema.Literals(["ask", "allow", "deny"])
  .annotate({ identifier: "PermissionActionConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Action = Schema.Schema.Type<typeof Action>

/**
 * Runtime permission mode. When omitted the permission layer defaults to
 * `supervised`; `full_access` must be opted into explicitly.
 */
export const Mode = Schema.Literals(["supervised", "auto_accept_edits", "auto", "full_access"])
  .annotate({ identifier: "PermissionModeConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Mode = Schema.Schema.Type<typeof Mode>

export const Object = Schema.Record(Schema.String, Action)
  .annotate({ identifier: "PermissionObjectConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Object = Schema.Schema.Type<typeof Object>

export const Rule = Schema.Union([Action, Object])
  .annotate({ identifier: "PermissionRuleConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Rule = Schema.Schema.Type<typeof Rule>

// Known permission keys get explicit types in the Effect schema for generated
// docs/types. Runtime config parsing uses Effect's `propertyOrder: "original"`
// parse option so user key order is preserved for permission precedence.
const InputObject = Schema.StructWithRest(
  Schema.Struct({
    // Reserved key: selects the runtime approval mode instead of a rule.
    mode: Schema.optional(Mode),
    read: Schema.optional(Rule),
    edit: Schema.optional(Rule),
    glob: Schema.optional(Rule),
    grep: Schema.optional(Rule),
    list: Schema.optional(Rule),
    bash: Schema.optional(Rule),
    task: Schema.optional(Rule),
    external_directory: Schema.optional(Rule),
    todowrite: Schema.optional(Action),
    question: Schema.optional(Action),
    webfetch: Schema.optional(Action),
    websearch: Schema.optional(Action),
    codesearch: Schema.optional(Action),
    repo_clone: Schema.optional(Rule),
    repo_overview: Schema.optional(Rule),
    lsp: Schema.optional(Rule),
    doom_loop: Schema.optional(Action),
    skill: Schema.optional(Rule),
    test_runner: Schema.optional(Rule),
    browser: Schema.optional(Rule),
    arch_map: Schema.optional(Rule),
    checkpoint: Schema.optional(Rule),
  }),
  // The rest record also accepts `Mode` so `permission.mode` can live next to
  // rule keys (Effect's StructWithRest applies the index signature to every
  // key). `Permission.fromConfig` skips the reserved `mode` key.
  [Schema.Record(Schema.String, Schema.Union([Rule, Mode]))],
)

// Input the user writes in config: either a single Action (shorthand for "*")
// or an object of per-target rules.
const InputSchema = Schema.Union([Action, InputObject])

// Normalise the Action shorthand into `{ "*": action }`. Object inputs pass
// through untouched.
const normalizeInput = (input: Schema.Schema.Type<typeof InputSchema>): Schema.Schema.Type<typeof InputObject> =>
  typeof input === "string" ? { "*": input } : input

export const Info = InputSchema.pipe(
  Schema.decodeTo(InputObject, {
    decode: SchemaGetter.transform(normalizeInput),
    // Not perfectly invertible (we lose whether the user originally typed an
    // Action shorthand), but the object form is always a valid representation
    // of the same rules.
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
)
  .annotate({ identifier: "PermissionConfig" })
  .pipe(
    // Walker already emits the decodeTo transform into the derived zod (see
    // `encoded()` in effect-zod.ts), so just expose that directly.
    withStatics((s) => ({ zod: zod(s) })),
  )
type _Info = Schema.Schema.Type<typeof InputObject>
export type Info = { -readonly [K in keyof _Info]: _Info[K] }
