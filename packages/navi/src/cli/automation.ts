// Helpers for the automation/CI output contract shared by `run` and `review`:
// final-message extraction, minimal JSON-schema validation, ANSI handling, and
// git diff collection. Kept free of UI/session imports so it stays unit
// testable without a live model or repository state.
import path from "path"
import { Process } from "../util/process"

export type ColorMode = "always" | "never" | "auto"

const ANSI_CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_OSC, "").replace(ANSI_CSI, "")
}

/** Blank out a style table (e.g. `UI.Style`) so no escape codes are emitted. */
export function disableStyles(styles: Record<string, string>): void {
  for (const key of Object.keys(styles)) styles[key] = ""
}

// ---------------------------------------------------------------------------
// Final assistant message
// ---------------------------------------------------------------------------

export type MessagePart = {
  type?: string
  text?: string
  ignored?: boolean
  synthetic?: boolean
  time?: { start?: number; end?: number; created?: number }
}

export type FinalMessage = {
  info?: { structured?: unknown }
  parts?: readonly MessagePart[]
}

/**
 * Text of the final assistant message. When the session requested structured
 * output, the structured value is the contract and is serialized as JSON.
 */
export function finalText(message: FinalMessage | undefined): string {
  if (message?.info?.structured !== undefined) return JSON.stringify(message.info.structured, null, 2)
  return (message?.parts ?? [])
    .filter(
      (part) =>
        part.type === "text" &&
        part.time?.end !== undefined &&
        part.ignored !== true &&
        part.synthetic !== true &&
        typeof part.text === "string",
    )
    .map((part) => (part.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
}

export type FinalValue = { ok: true; value: unknown } | { ok: false; error: string }

/** Human-readable message for SDK result-tuple errors and thrown values. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const record = error as { data?: { message?: unknown }; message?: unknown; name?: unknown }
    if (typeof record.data?.message === "string") return record.data.message
    if (typeof record.message === "string") return record.message
    if (typeof record.name === "string") return record.name
    return JSON.stringify(error)
  }
  return String(error)
}

/** Structured value if present, otherwise the final text parsed as JSON. */
export function finalValue(message: FinalMessage | undefined): FinalValue {
  if (message?.info?.structured !== undefined) return { ok: true, value: message.info.structured }
  const text = finalText(message)
  if (!text.trim()) return { ok: false, error: "assistant produced no output to validate" }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: `assistant output is not valid JSON: ${messageOf(error)}` }
  }
}

// ---------------------------------------------------------------------------
// Output contract
// ---------------------------------------------------------------------------

export type ContractWrite = { ok: true; text: string; file?: string } | { ok: false; errors: string[] }

/**
 * Validate the final assistant message against `schema` and only then persist
 * it. Validation runs before any write so a contract failure neither creates a
 * new output file nor overwrites an existing one.
 */
export async function writeFinalMessage(input: {
  message: FinalMessage | undefined
  schema?: unknown
  output?: string
  cwd?: string
}): Promise<ContractWrite> {
  if (input.schema !== undefined) {
    const parsed = finalValue(input.message)
    if (!parsed.ok) return { ok: false, errors: [parsed.error] }
    const errors = validateSchema(input.schema, parsed.value)
    if (errors.length > 0) return { ok: false, errors: errors.map((error) => `${error.path}: ${error.message}`) }
  }

  const text = finalText(input.message)
  if (!input.output) return { ok: true, text }
  if (!text.trim()) return { ok: false, errors: ["The assistant produced no output to write"] }

  const file = path.resolve(input.cwd ?? process.cwd(), input.output)
  try {
    await Bun.write(file, text)
  } catch (error) {
    return { ok: false, errors: [`Failed to write ${input.output}: ${messageOf(error)}`] }
  }
  return { ok: true, text, file }
}

// ---------------------------------------------------------------------------
// JSON schema validation (type/required/properties/items/enum)
// ---------------------------------------------------------------------------

export type SchemaError = { path: string; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Small structural validator covering the subset of JSON Schema that CLI
 * output contracts need: `type` (string or array), `required`, `properties`,
 * `items`, and `enum`. Unknown keywords are ignored rather than rejected.
 */
export function validateSchema(schema: unknown, value: unknown, path = "$"): SchemaError[] {
  if (!isRecord(schema)) return []

  const typeErrors = validateType(schema.type, value, path)
  if (typeErrors.length > 0) return typeErrors

  const errors: SchemaError[] = []

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEqual(entry, value))) {
    errors.push({ path, message: `expected one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}` })
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : []
    for (const key of required) {
      if (!(key in value)) errors.push({ path: `${path}.${key}`, message: "required property is missing" })
    }
    if (isRecord(schema.properties)) {
      for (const [key, child] of Object.entries(schema.properties)) {
        if (key in value) errors.push(...validateSchema(child, value[key], `${path}.${key}`))
      }
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => errors.push(...validateSchema(schema.items, item, `${path}[${index}]`)))
  }

  return errors
}

function validateType(type: unknown, value: unknown, path: string): SchemaError[] {
  const expected = Array.isArray(type)
    ? type.filter((entry): entry is string => typeof entry === "string")
    : typeof type === "string"
      ? [type]
      : []
  if (expected.length === 0) return []
  if (expected.some((name) => matchesType(name, value))) return []
  return [{ path, message: `expected ${expected.join(" | ")}, got ${jsonType(value)}` }]
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return isRecord(value)
    case "array":
      return Array.isArray(value)
    case "string":
      return typeof value === "string"
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
    case "boolean":
      return typeof value === "boolean"
    case "null":
      return value === null
    default:
      return true
  }
}

function jsonType(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number"
  if (typeof value === "object") return "object"
  return typeof value
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && deepEqual(a[key], b[key]))
  }
  return false
}

export type SchemaParse = { ok: true; schema: Record<string, unknown> } | { ok: false; error: string }

export function parseSchema(source: string): SchemaParse {
  let schema: unknown
  try {
    schema = JSON.parse(source)
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${messageOf(error)}` }
  }
  if (!isRecord(schema)) return { ok: false, error: "schema must be a JSON object" }
  return { ok: true, schema }
}

// ---------------------------------------------------------------------------
// Git diff collection
// ---------------------------------------------------------------------------

export type DiffTarget =
  | { type: "uncommitted" }
  | { type: "base"; ref: string }
  | { type: "commit"; sha: string }

export type DiffTargetResult = { ok: true; target: DiffTarget } | { ok: false; error: string }

export function resolveDiffTarget(input: {
  base?: string
  commit?: string
  uncommitted?: boolean
}): DiffTargetResult {
  if (input.base && input.commit) return { ok: false, error: "--base and --commit cannot be used together" }
  if (input.uncommitted === true && (input.base || input.commit)) {
    return { ok: false, error: "--uncommitted cannot be combined with --base or --commit" }
  }
  if (input.commit) return { ok: true, target: { type: "commit", sha: input.commit } }
  if (input.base) return { ok: true, target: { type: "base", ref: input.base } }
  return { ok: true, target: { type: "uncommitted" } }
}

/** Git argv for a review target. Exported so tests can assert the refs used. */
export function diffArgs(target: DiffTarget): string[] {
  switch (target.type) {
    case "uncommitted":
      // Compare against HEAD so staged changes are included; plain `git diff`
      // silently skips anything already added to the index.
      return ["git", "diff", "--no-color", "HEAD"]
    case "base":
      return ["git", "diff", "--no-color", `${target.ref}...HEAD`]
    case "commit":
      return ["git", "show", "--no-color", target.sha]
  }
}

export type DiffRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>

const git: DiffRunner = async (args, cwd) => {
  const result = await Process.text(args, {
    cwd,
    nothrow: true,
    env: { GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
  })
  return { code: result.code, stdout: result.text, stderr: result.stderr.toString() }
}

export type TargetResolution = { ok: true; target: DiffTarget } | { ok: false; error: string }

async function resolveRevision(
  run: DiffRunner,
  cwd: string,
  ref: string,
): Promise<{ ok: true; sha: string } | { ok: false; error: string }> {
  const result = await run(["git", "rev-parse", "--verify", `${ref}^{commit}`], cwd)
  const sha = result.stdout.trim()
  if (result.code === 0 && /^[0-9a-f]{40,64}$/.test(sha)) return { ok: true, sha }
  const stderr = result.stderr.trim()
  return { ok: false, error: stderr ? `${ref}: ${stderr}` : `unknown revision: ${ref}` }
}

/**
 * Resolve the refs in a diff target to full commit ids so reports and diffs use
 * the real sha instead of the user-supplied string (`HEAD`, a branch, or an
 * abbreviated id). Invalid refs come back as a clear error.
 */
export async function resolveTarget(input: {
  target: DiffTarget
  cwd?: string
  run?: DiffRunner
}): Promise<TargetResolution> {
  if (input.target.type === "uncommitted") return { ok: true, target: input.target }
  const cwd = input.cwd ?? process.cwd()
  const run = input.run ?? git

  if (input.target.type === "commit") {
    const resolved = await resolveRevision(run, cwd, input.target.sha)
    if (!resolved.ok) return { ok: false, error: `--commit: ${resolved.error}` }
    return { ok: true, target: { type: "commit", sha: resolved.sha } }
  }

  const resolved = await resolveRevision(run, cwd, input.target.ref)
  if (!resolved.ok) return { ok: false, error: `--base: ${resolved.error}` }
  return { ok: true, target: { type: "base", ref: resolved.sha } }
}

export async function collectDiff(input: {
  target: DiffTarget
  cwd?: string
  run?: DiffRunner
}): Promise<string> {
  const cwd = input.cwd ?? process.cwd()
  const run = input.run ?? git
  const failure = (out: { code: number; stderr: string }) => {
    const stderr = out.stderr.trim()
    return new Error(`git exited with code ${out.code}${stderr ? `: ${stderr}` : ""}`)
  }
  const result = await run(diffArgs(input.target), cwd)
  if (result.code === 0) return result.stdout
  // `git diff HEAD` fails in a repository with no commits; fall back to the
  // index diff so staged files in a fresh repository still produce a review.
  if (input.target.type === "uncommitted") {
    const cached = await run(["git", "diff", "--no-color", "--cached"], cwd)
    if (cached.code === 0) return cached.stdout
    throw failure(cached)
  }
  throw failure(result)
}

export * as Automation from "./automation"
