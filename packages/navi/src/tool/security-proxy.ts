import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { globalHttpTraffic } from "@/security/proxy/http-traffic"

const DESCRIPTION =
  "Offensive security HTTP proxy and request manipulation tool. Inspects, searches, tampers, and replays HTTP requests to probe for vulnerabilities like IDOR, BOLA, injection, and auth bypass."

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "view", "repeat", "send"]).annotate({
    description: "Action to perform: 'list', 'view', 'repeat', or 'send'",
  }),
  request_id: Schema.optional(Schema.String).annotate({
    description: "Request ID to view or repeat (for 'view' or 'repeat')",
  }),
  method: Schema.optional(Schema.String).annotate({
    description: "HTTP method (e.g. 'GET', 'POST', 'PUT', 'DELETE')",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "Target URL (for 'send' or to override in 'repeat')",
  }),
  headers: Schema.optional(Schema.String).annotate({
    description: "HTTP headers as a JSON string (e.g. '{\"Authorization\": \"Bearer ...\"}')",
  }),
  body: Schema.optional(Schema.String).annotate({
    description: "HTTP request payload/body",
  }),
  filter_url: Schema.optional(Schema.String).annotate({
    description: "Regex pattern to filter requests (for 'list')",
  }),
})

function parseHeaders(raw?: string): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") result[k] = v
      else if (v !== undefined && v !== null) result[k] = String(v)
    }
    return result
  } catch {
    return {}
  }
}

export const SecurityProxyTool = Tool.define(
  "security_proxy",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "list") {
            const list = globalHttpTraffic.list({
              method: params.method,
              urlPattern: params.filter_url,
            })
            return {
              title: "HTTP Traffic History",
              output: JSON.stringify(
                list.map((r) => ({
                  id: r.id,
                  timestamp: r.timestamp,
                  method: r.method,
                  url: r.url,
                  status: r.response?.statusCode,
                  durationMs: r.response?.durationMs,
                })),
                null,
                2,
              ),
              metadata: { count: list.length } as Record<string, unknown>,
            }
          }

          if (params.action === "view") {
            if (!params.request_id) {
              return {
                title: "View Request Error",
                output: "Error: 'request_id' is required for action 'view'",
                metadata: { found: false } as Record<string, unknown>,
              }
            }
            const req = globalHttpTraffic.get(params.request_id)
            if (!req) {
              return {
                title: "Request Not Found",
                output: `Request ID ${params.request_id} not found in proxy traffic history.`,
                metadata: { found: false } as Record<string, unknown>,
              }
            }
            return {
              title: `Request #${req.id} (${req.method} ${req.url})`,
              output: JSON.stringify(req, null, 2),
              metadata: { found: true, id: req.id } as Record<string, unknown>,
            }
          }

          if (params.action === "send") {
            if (!params.url) {
              return {
                title: "Send Request Error",
                output: "Error: 'url' is required for action 'send'",
                metadata: { success: false } as Record<string, unknown>,
              }
            }
            const headers = parseHeaders(params.headers)
            const captured = yield* Effect.promise(() =>
              globalHttpTraffic.sendNew(
                params.method || "GET",
                params.url!,
                headers,
                params.body,
              ),
            )
            return {
              title: `HTTP Response #${captured.id} [${captured.response?.statusCode}]`,
              output: [
                `Status: ${captured.response?.statusCode} ${captured.response?.statusText}`,
                `Duration: ${captured.response?.durationMs}ms`,
                `Headers: ${JSON.stringify(captured.response?.headers, null, 2)}`,
                "",
                "Body:",
                captured.response?.body || "(empty)",
              ].join("\n"),
              metadata: { id: captured.id, status: captured.response?.statusCode } as Record<string, unknown>,
            }
          }

          if (params.action === "repeat") {
            if (!params.request_id) {
              return {
                title: "Repeat Request Error",
                output: "Error: 'request_id' is required for action 'repeat'",
                metadata: { success: false } as Record<string, unknown>,
              }
            }
            const headers = params.headers ? parseHeaders(params.headers) : undefined
            const repeated = yield* Effect.promise(() =>
              globalHttpTraffic.repeat(params.request_id!, {
                method: params.method,
                url: params.url,
                headers,
                body: params.body,
              }),
            )
            return {
              title: `Repeated Request #${repeated.id} [${repeated.response?.statusCode}]`,
              output: [
                `Replayed from #${params.request_id}`,
                `Status: ${repeated.response?.statusCode} ${repeated.response?.statusText}`,
                `Duration: ${repeated.response?.durationMs}ms`,
                `Headers: ${JSON.stringify(repeated.response?.headers, null, 2)}`,
                "",
                "Body:",
                repeated.response?.body || "(empty)",
              ].join("\n"),
              metadata: { id: repeated.id, status: repeated.response?.statusCode } as Record<string, unknown>,
            }
          }

          return {
            title: "Security Proxy",
            output: `Unknown action: ${params.action}`,
            metadata: {} as Record<string, unknown>,
          }
        }),
    }
  }),
)
