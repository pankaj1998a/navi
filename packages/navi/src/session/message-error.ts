import { Schema } from "effect"
import { namedSchemaError } from "@/util/named-schema-error"

export const OutputLengthError = namedSchemaError("MessageOutputLengthError", {})

export const AuthError = namedSchemaError("ProviderAuthError", {
  providerID: Schema.String,
  message: Schema.String,
})

export const UnknownError = Schema.Struct({
  name: Schema.Literal("UnknownError"),
  data: Schema.Struct({ message: Schema.String }),
}).annotate({ identifier: "UnknownError" })

export const Shared = [AuthError.EffectSchema, UnknownError, OutputLengthError.EffectSchema] as const
export const SharedSchema = Schema.Union(Shared)

export * as MessageError from "./message-error"
