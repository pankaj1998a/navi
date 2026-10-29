/**
 * OpenAPI & Swagger Specification Parser
 * Ingests API contracts (JSON or YAML) to discover endpoints, methods, parameters, and auth schemes,
 * automatically populating the Attack Surface Coverage tracker.
 */

import { globalCoverageStore, type CoverageEntry } from "./coverage"
import fs from "fs"

export interface ParsedApiEndpoint {
  method: string
  path: string
  summary?: string
  parameters: string[]
  requestBodyFields?: string[]
  security?: string[]
}

export interface ParsedApiSpec {
  title: string
  version: string
  baseUrls: string[]
  endpoints: ParsedApiEndpoint[]
}

export function parseOpenApiSpec(contentOrPath: string): ParsedApiSpec {
  let raw = contentOrPath.trim()

  if (fs.existsSync(contentOrPath)) {
    raw = fs.readFileSync(contentOrPath, "utf-8")
  }

  let spec: Record<string, unknown>
  try {
    spec = JSON.parse(raw) as Record<string, unknown>
  } catch {
    // If YAML, parse via simple key-value and path scanner if yaml parser not available
    spec = parseSimpleYamlOrJson(raw)
  }

  const title = (spec.info as Record<string, unknown>)?.title ? String((spec.info as Record<string, unknown>).title) : "API Spec"
  const version = (spec.info as Record<string, unknown>)?.version ? String((spec.info as Record<string, unknown>).version) : "1.0.0"

  const baseUrls: string[] = []
  if (Array.isArray(spec.servers)) {
    for (const server of spec.servers) {
      if (server && typeof server === "object" && "url" in server) {
        baseUrls.push(String(server.url))
      }
    }
  } else if (typeof spec.host === "string") {
    const scheme = Array.isArray(spec.schemes) && spec.schemes[0] ? spec.schemes[0] : "https"
    const basePath = typeof spec.basePath === "string" ? spec.basePath : ""
    baseUrls.push(`${scheme}://${spec.host}${basePath}`)
  }

  const endpoints: ParsedApiEndpoint[] = []
  const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>

  for (const [routePath, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue

    for (const [method, details] of Object.entries(methods)) {
      const upperMethod = method.toUpperCase()
      if (!["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].includes(upperMethod)) {
        continue
      }

      const op = details as Record<string, unknown>
      const paramsList: string[] = []

      if (Array.isArray(op.parameters)) {
        for (const p of op.parameters) {
          if (p && typeof p === "object" && "name" in p) {
            paramsList.push(String(p.name))
          }
        }
      }

      endpoints.push({
        method: upperMethod,
        path: routePath,
        summary: op.summary ? String(op.summary) : undefined,
        parameters: paramsList,
      })

      // Register into global coverage store
      globalCoverageStore.record({
        asset: baseUrls[0] || "api",
        method: upperMethod,
        endpoint: routePath,
        parameters: paramsList,
        status: "discovered",
        tested_vulnerability_types: [],
        notes: op.summary ? `Declared in OpenAPI: ${op.summary}` : "Declared in OpenAPI",
      })
    }
  }

  return {
    title,
    version,
    baseUrls,
    endpoints,
  }
}

function parseSimpleYamlOrJson(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = { paths: {} }
  const lines = raw.split("\n")
  let currentPath: string | null = null
  let currentMethod: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    // Detect paths like `  /users/{id}:`
    const pathMatch = line.match(/^\s{2,4}(\/[a-zA-Z0-9_\-/{}.]+):\s*$/)
    if (pathMatch && pathMatch[1]) {
      currentPath = pathMatch[1]
      const paths = result.paths as Record<string, Record<string, unknown>>
      if (!paths[currentPath]) paths[currentPath] = {}
      continue
    }

    // Detect HTTP methods under path like `    get:` or `    post:`
    const methodMatch = line.match(/^\s{4,6}(get|post|put|delete|patch|options|head):\s*$/i)
    if (methodMatch && currentPath && methodMatch[1]) {
      currentMethod = methodMatch[1].toLowerCase()
      const paths = result.paths as Record<string, Record<string, unknown>>
      const p = paths[currentPath]
      if (p) p[currentMethod] = { parameters: [] }
    }
  }

  return result
}
