import { isRecord } from "./record"

export interface NodeError extends Error {
  code?: string
  errno?: number
  path?: string
  syscall?: string
}

export function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error && "code" in error
}

export function isEnoent(e: unknown): e is { code: "ENOENT" } {
  return isNodeError(e) && e.code === "ENOENT"
}

export class FileNotFoundError extends Error {
  constructor(public filepath: string, public suggestions?: string[]) {
    const message = suggestions && suggestions.length > 0 
      ? `File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`
      : `File not found: ${filepath}`
    super(message)
    this.name = "FileNotFoundError"
  }
}

export function assertRequired<T>(val: T | undefined | null, name: string): T {
  if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
    throw new Error(`${name} is required`)
  }
  return val
}

export function errorFormat(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error, null, 2)
    } catch {
      return "Unexpected error (unserializable)"
    }
  }

  return String(error)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message
    if (error.name) return error.name
  }

  if (isRecord(error) && typeof error.message === "string" && error.message) {
    return error.message
  }

  const text = String(error)
  if (text && text !== "[object Object]") return text

  const formatted = errorFormat(error)
  if (formatted && formatted !== "{}") return formatted
  return "unknown error"
}

export function errorData(error: unknown) {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: errorMessage(error),
      stack: error.stack,
      cause: error.cause === undefined ? undefined : errorFormat(error.cause),
      formatted: errorFormatted(error),
    }
  }

  if (!isRecord(error)) {
    return {
      type: typeof error,
      message: errorMessage(error),
      formatted: errorFormatted(error),
    }
  }

  const data = Object.getOwnPropertyNames(error).reduce<Record<string, unknown>>((acc, key) => {
    const value = error[key]
    if (value === undefined) return acc
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      acc[key] = value
      return acc
    }
    acc[key] = value instanceof Error ? value.message : String(value)
    return acc
  }, {})

  if (typeof data.message !== "string") data.message = errorMessage(error)
  if (typeof data.type !== "string") data.type = error.constructor?.name
  data.formatted = errorFormatted(error)
  return data
}

function errorFormatted(error: unknown) {
  const formatted = errorFormat(error)
  if (formatted !== "{}") return formatted
  return String(error)
}

