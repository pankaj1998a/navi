import { Schema } from "effect"

export const Unknown = Schema.Struct({
  kind: Schema.String,
  message: Schema.String,
  path: Schema.optional(Schema.String),
})

export type Unknown = Schema.Schema.Type<typeof Unknown>

export const ObservedModule = Schema.Struct({
  path: Schema.String,
  digest: Schema.String,
  imports: Schema.Array(Schema.String),
  exports: Schema.Array(Schema.String),
  lines: Schema.Number,
})

export type ObservedModule = Schema.Schema.Type<typeof ObservedModule>

export const EvidenceBundle = Schema.Struct({
  root: Schema.String,
  modules: Schema.Array(ObservedModule),
  unknowns: Schema.Array(Unknown),
  packageName: Schema.optional(Schema.String),
  electronMain: Schema.optional(Schema.String),
})

export type EvidenceBundle = Schema.Schema.Type<typeof EvidenceBundle>

export const unknown = (kind: string, message: string, path?: string): Unknown =>
  path === undefined ? { kind, message } : { kind, message, path }

export * as ReverseEvidence from "./evidence"
