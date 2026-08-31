export * as ConfigParse from "./parse"

import { type ParseError as JsoncParseError, parse as parseJsoncImpl, printParseErrorCode } from "jsonc-parser"
import { Cause, Exit, Schema as EffectSchema, SchemaIssue } from "effect"
import z from "zod"
import type { DeepMutable } from "@navi-ai/core/schema"
import { InvalidError, JsonError } from "./error"

type ZodSchema<T> = z.ZodType<T>

export function jsonc(text: string, filepath: string): unknown {
  const errors: JsoncParseError[] = []
  const data = parseJsoncImpl(text, errors, { allowTrailingComma: true })
  if (errors.length) {
    const lines = text.split("\n")
    const issues = errors
      .map((e) => {
        const beforeOffset = text.substring(0, e.offset).split("\n")
        const line = beforeOffset.length
        const column = beforeOffset[beforeOffset.length - 1].length + 1
        const problemLine = lines[line - 1]

        const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
        if (!problemLine) return error

        return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
      })
      .join("\n")
    throw new JsonError({
      path: filepath,
      message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${issues}\n--- End ---`,
    })
  }

  return data
}

export function schema<T>(schema: ZodSchema<T>, data: unknown, source: string): T {
  const parsed = schema.safeParse(data)
  if (parsed.success) return parsed.data

  throw new InvalidError({
    path: source,
    issues: parsed.error.issues,
  })
}

export function effectSchema<S extends EffectSchema.Decoder<unknown, never>>(
  schema: S,
  data: unknown,
  source: string,
): DeepMutable<S["Type"]> {
  const extra = topLevelExtraKeys(schema, data)
  if (extra.length) {
    throw new InvalidError({
      path: source,
      issues: [
        {
          code: "unrecognized_keys",
          keys: extra,
          path: [],
          message: `Unrecognized key${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}`,
        } as z.core.$ZodIssue,
      ],
    })
  }

  const decoded = EffectSchema.decodeUnknownExit(schema)(data, { errors: "all", propertyOrder: "original" })
  if (Exit.isSuccess(decoded)) return decoded.value as DeepMutable<S["Type"]>
  const error = Cause.squash(decoded.cause)

  throw new InvalidError(
    {
      path: source,
      issues: EffectSchema.isSchemaError(error)
        ? (SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues as z.core.$ZodIssue[])
        : ([{ code: "custom", message: String(error), path: [] }] as z.core.$ZodIssue[]),
    },
    { cause: error },
  )
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
}

function isTypeLiteralAST(ast: any): boolean {
  return ast?._tag === "TypeLiteral" || ast?._tag === "Objects"
}

function unwrapAST(ast: any): any {
  if (!ast || typeof ast !== "object") return ast
  if (ast._tag === "Transformation") {
    if (ast.from) return unwrapAST(ast.from)
    if (ast.to) return unwrapAST(ast.to)
  }
  if (ast._tag === "Declaration" && ast.typeParameters?.[0]) return unwrapAST(ast.typeParameters[0])
  if (ast._tag === "Refinement" && ast.from) return unwrapAST(ast.from)
  if (ast._tag === "Suspend") {
    try {
      const f = ast.f
      if (typeof f === "function") {
        const inner = f()
        if (inner) return unwrapAST(inner)
      }
    } catch {}
  }
  return ast
}

function getInnerType(ast: any): any {
  const norm = unwrapAST(ast)
  if (norm?._tag === "Union") {
    const nonUndefined = norm.types.filter((t: any) => t._tag !== "UndefinedKeyword")
    if (nonUndefined.length === 0) return norm
    if (nonUndefined.length === 1) return unwrapAST(nonUndefined[0])
    return { ...norm, types: nonUndefined }
  }
  return norm
}

function collectExtraKeys(ast: any, data: unknown, prefix: string): string[] {
  if (!isPlainObject(data)) return []
  const norm = unwrapAST(ast)
  if (isTypeLiteralAST(norm)) {
    const propSigs: any[] = norm.propertySignatures ?? []
    const idxSigs: any[] = norm.indexSignatures ?? []
    if (idxSigs.length === 0) {
      const known = new Set(propSigs.map((p: any) => String(p.name)))
      const extras: string[] = []
      for (const key of Object.keys(data as Record<string, unknown>)) {
        const curPath = prefix ? `${prefix}.${key}` : key
        if (!known.has(key)) {
          extras.push(curPath)
        } else {
          const sig = propSigs.find((p: any) => String(p.name) === key)
          if (sig) {
            const childAST = getInnerType(sig.type)
            if (childAST?._tag === "Union" && isPlainObject((data as any)[key])) {
              let best: string[] | null = null
              for (const member of childAST.types) {
                const e = collectExtraKeys(member, (data as any)[key], curPath)
                if (best === null || e.length < best.length) best = e
              }
              if (best) extras.push(...best)
            } else {
              extras.push(...collectExtraKeys(childAST, (data as any)[key], curPath))
            }
          }
        }
      }
      return extras
    } else {
      const knownMap = new Map(propSigs.map((p: any) => [String(p.name), p.type]))
      const extras: string[] = []
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const curPath = prefix ? `${prefix}.${key}` : key
        let childAST: any
        if (knownMap.has(key)) childAST = getInnerType(knownMap.get(key))
        else childAST = getInnerType(idxSigs[0].type)
        if (!childAST) continue
        if (isPlainObject(value)) {
          if (childAST._tag === "Union") {
            let best: string[] | null = null
            for (const member of childAST.types) {
              if (member._tag === "UndefinedKeyword") continue
              const e = collectExtraKeys(member, value, curPath)
              if (best === null || e.length < best.length) best = e
            }
            if (best) extras.push(...best)
          } else {
            extras.push(...collectExtraKeys(childAST, value, curPath))
          }
        }
      }
      return extras
    }
  } else if (norm?._tag === "Union") {
    let best: string[] | null = null
    for (const member of norm.types) {
      if (member._tag === "UndefinedKeyword") continue
      const e = collectExtraKeys(member, data, prefix)
      if (best === null || e.length < best.length) best = e
    }
    return best ?? []
  } else if (norm?._tag === "Suspend") {
    try {
      return collectExtraKeys(norm.f(), data, prefix)
    } catch {
      return []
    }
  }
  return []
}

function topLevelExtraKeys(schema: EffectSchema.Top, data: unknown): string[] {
  if (!isPlainObject(data)) return []
  const ast: any = (schema as any).ast
  if (!ast) return []
  return collectExtraKeys(ast, data, "")
}
