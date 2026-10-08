import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as Log from "@navi-ai/core/util/log"
import DESCRIPTION from "./agentation.txt"

const log = Log.create({ service: "tool.agentation" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["pending", "status", "resolve", "acknowledge", "dismiss", "reply", "sessions", "watch"]).annotate({
    description: "The Agentation action to perform: 'pending', 'status', 'resolve', 'acknowledge', 'dismiss', 'reply', 'sessions', or 'watch'",
  }),
  id: Schema.optional(Schema.String).annotate({
    description: "Annotation ID to resolve, acknowledge, dismiss, or reply to",
  }),
  sessionId: Schema.optional(Schema.String).annotate({
    description: "Optional session ID to scope annotations or queries",
  }),
  message: Schema.optional(Schema.String).annotate({
    description: "Reply comment or dismissal reason",
  }),
  timeoutSeconds: Schema.optional(Schema.Number).annotate({
    description: "Timeout in seconds when watching for annotations (default: 20)",
  }),
  endpoint: Schema.optional(Schema.String).annotate({
    description: "Agentation server endpoint URL (defaults to http://localhost:4747)",
  }),
})

interface AnnotationItem {
  id?: string
  element?: string
  comment?: string
  nearbyText?: string
  reactComponents?: string
  sourceLocation?: string
  page?: string
  url?: string
  status?: string
}

export const AgentationTool = Tool.define(
  "agentation",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "agentation",
            patterns: [params.action],
            always: ["*"],
            metadata: { action: params.action, id: params.id },
          })

          const baseUrl = (params.endpoint || "http://localhost:4747").replace(/\/$/, "")

          switch (params.action) {
            case "status": {
              return yield* Effect.promise(async () => {
                try {
                  const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) })
                  if (res.ok) {
                    return {
                      title: "Agentation Server Status",
                      output: `✓ Agentation annotation server is ONLINE and responding at ${baseUrl}.`,
                      metadata: { status: "online", endpoint: baseUrl } as Record<string, unknown>,
                    }
                  }
                  return {
                    title: "Agentation Server Status",
                    output: `⚠ Agentation server responded with HTTP status ${res.status} at ${baseUrl}.`,
                    metadata: { status: "unexpected_status", code: res.status } as Record<string, unknown>,
                  }
                } catch {
                  return {
                    title: "Agentation Server Offline",
                    output: `❌ Cannot connect to Agentation server at ${baseUrl}. Start it with \`npx -y agentation-mcp server\`.`,
                    metadata: { status: "offline", endpoint: baseUrl } as Record<string, unknown>,
                  }
                }
              })
            }

            case "pending": {
              return yield* Effect.promise(async () => {
                const targetUrl = params.sessionId ? `${baseUrl}/sessions/${params.sessionId}/pending` : `${baseUrl}/pending`
                try {
                  const res = await fetch(targetUrl, { signal: AbortSignal.timeout(3000) })
                  if (!res.ok) {
                    return {
                      title: "Fetch Annotations Failed",
                      output: `❌ HTTP ${res.status} fetching annotations from ${targetUrl}`,
                      metadata: { error: "http_error", status: res.status } as Record<string, unknown>,
                    }
                  }
                  const data = (await res.json()) as { count?: number; annotations?: AnnotationItem[] }
                  const annotations = data.annotations || []

                  if (annotations.length === 0) {
                    return {
                      title: "Agentation Pending Feedback (0)",
                      output: "✓ No pending UI annotations found. The user has not pinned any unresolved comments.",
                      metadata: { count: 0, annotations: [] } as Record<string, unknown>,
                    }
                  }

                  const outputLines = [
                    `### 🎯 Agentation Pending UI Feedback (${annotations.length} items)`,
                    "",
                  ]

                  annotations.forEach((a, i) => {
                    outputLines.push(
                      `#### [${i + 1}] Element: \`${a.element || "element"}\`${a.id ? ` (ID: \`${a.id}\`)` : ""}`,
                      `- **User Comment**: ${a.comment || "(no comment)"}`,
                    )
                    if (a.reactComponents) outputLines.push(`- **React Component**: \`<${a.reactComponents}>\``)
                    if (a.sourceLocation) outputLines.push(`- **Source Location**: \`${a.sourceLocation}\``)
                    if (a.nearbyText) outputLines.push(`- **Nearby DOM Text**: "${a.nearbyText.slice(0, 100)}${a.nearbyText.length > 100 ? "…" : ""}"`)
                    if (a.page || a.url) outputLines.push(`- **URL/Page**: \`${a.page || a.url}\``)
                    outputLines.push("")
                  })

                  outputLines.push(
                    `To mark an issue resolved after fixing code, call \`agentation\` with \`action: "resolve"\` and \`id: "<ID>"\`.`,
                  )

                  return {
                    title: `Agentation Pending Feedback (${annotations.length})`,
                    output: outputLines.join("\n"),
                    metadata: { count: annotations.length, annotations } as Record<string, unknown>,
                  }
                } catch {
                  return {
                    title: "Agentation Offline",
                    output: `❌ Cannot connect to Agentation server at ${baseUrl}. Ensure \`npx -y agentation-mcp server\` is running.`,
                    metadata: { error: "unreachable" } as Record<string, unknown>,
                  }
                }
              })
            }

            case "resolve":
            case "acknowledge":
            case "dismiss": {
              if (!params.id) {
                return {
                  title: "Missing ID",
                  output: `❌ Annotation 'id' parameter is required for action '${params.action}'.`,
                  metadata: { error: "missing_id" } as Record<string, unknown>,
                }
              }

              return yield* Effect.promise(async () => {
                const subPath = params.action === "resolve" ? "resolve" : params.action === "acknowledge" ? "acknowledge" : "dismiss"
                try {
                  const res = await fetch(`${baseUrl}/annotations/${params.id}/${subPath}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reason: params.message }),
                    signal: AbortSignal.timeout(3000),
                  })

                  if (res.ok) {
                    return {
                      title: `Annotation ${subPath}d`,
                      output: `✓ Marked annotation \`${params.id}\` as ${subPath}d.`,
                      metadata: { success: true, id: params.id, action: params.action } as Record<string, unknown>,
                    }
                  }

                  // Fallback PATCH if dedicated endpoint is unavailable
                  const patchRes = await fetch(`${baseUrl}/annotations/${params.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      resolved: params.action === "resolve",
                      acknowledged: params.action === "acknowledge",
                      dismissed: params.action === "dismiss",
                      reason: params.message,
                    }),
                    signal: AbortSignal.timeout(3000),
                  })

                  if (patchRes.ok) {
                    return {
                      title: `Annotation ${subPath}d`,
                      output: `✓ Updated annotation \`${params.id}\` state to ${subPath}d via PATCH.`,
                      metadata: { success: true, id: params.id, action: params.action } as Record<string, unknown>,
                    }
                  }

                  return {
                    title: `Failed to update annotation`,
                    output: `❌ HTTP ${patchRes.status} trying to update annotation \`${params.id}\`.`,
                    metadata: { error: "patch_failed", status: patchRes.status } as Record<string, unknown>,
                  }
                } catch (err: any) {
                  return {
                    title: "Network Error",
                    output: `❌ Could not reach Agentation server: ${err?.message || err}`,
                    metadata: { error: "network_error" } as Record<string, unknown>,
                  }
                }
              })
            }

            case "reply": {
              if (!params.id || !params.message) {
                return {
                  title: "Missing Parameters",
                  output: "❌ Both 'id' and 'message' are required to reply to an annotation.",
                  metadata: { error: "missing_parameters" } as Record<string, unknown>,
                }
              }

              return yield* Effect.promise(async () => {
                try {
                  const res = await fetch(`${baseUrl}/annotations/${params.id}/replies`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: params.message }),
                    signal: AbortSignal.timeout(3000),
                  })
                  if (res.ok) {
                    return {
                      title: "Reply Posted",
                      output: `✓ Posted reply to annotation \`${params.id}\`: "${params.message}"`,
                      metadata: { success: true, id: params.id } as Record<string, unknown>,
                    }
                  }
                  return {
                    title: "Reply Failed",
                    output: `❌ HTTP ${res.status} posting reply to annotation \`${params.id}\`.`,
                    metadata: { error: "reply_failed", status: res.status } as Record<string, unknown>,
                  }
                } catch (err: any) {
                  return {
                    title: "Network Error",
                    output: `❌ Could not reach Agentation server: ${err?.message || err}`,
                    metadata: { error: "network_error" } as Record<string, unknown>,
                  }
                }
              })
            }

            case "sessions": {
              return yield* Effect.promise(async () => {
                try {
                  const res = await fetch(`${baseUrl}/sessions`, { signal: AbortSignal.timeout(3000) })
                  if (!res.ok) {
                    return {
                      title: "Fetch Sessions Failed",
                      output: `❌ HTTP ${res.status} fetching sessions from ${baseUrl}/sessions`,
                      metadata: { error: "http_error", status: res.status } as Record<string, unknown>,
                    }
                  }
                  const sessions = (await res.json()) as Array<{ id: string; url?: string; createdAt?: string }>
                  return {
                    title: `Agentation Sessions (${sessions.length})`,
                    output: [
                      `### Active Annotation Sessions (${sessions.length})`,
                      "",
                      ...sessions.map((s) => `- **Session \`${s.id}\`**: ${s.url || "default"} (${s.createdAt || "active"})`),
                    ].join("\n"),
                    metadata: { sessions } as Record<string, unknown>,
                  }
                } catch {
                  return {
                    title: "Agentation Offline",
                    output: `❌ Cannot connect to Agentation server at ${baseUrl}.`,
                    metadata: { error: "unreachable" } as Record<string, unknown>,
                  }
                }
              })
            }

            case "watch": {
              const timeout = Math.min(60, Math.max(3, params.timeoutSeconds || 20))
              return yield* Effect.promise(async () => {
                const startTime = Date.now()
                const pendingUrl = params.sessionId
                  ? `${baseUrl}/sessions/${params.sessionId}/pending`
                  : `${baseUrl}/pending`

                while (Date.now() - startTime < timeout * 1000) {
                  try {
                    const res = await fetch(pendingUrl, { signal: AbortSignal.timeout(2000) })
                    if (res.ok) {
                      const data = (await res.json()) as { count?: number; annotations?: AnnotationItem[] }
                      const items = data.annotations || []
                      if (items.length > 0) {
                        return {
                          title: `New Annotations Detected (${items.length})`,
                          output: [
                            `### Received ${items.length} Pending Annotation(s):`,
                            "",
                            ...items.map((item, i) => {
                              const lines = [`**#${i + 1} ID**: \`${item.id}\``]
                              if (item.comment) lines.push(`- **Feedback**: ${item.comment}`)
                              if (item.element) lines.push(`- **Target Element**: \`${item.element}\``)
                              if (item.reactComponents) lines.push(`- **React Component**: \`<${item.reactComponents}>\``)
                              if (item.sourceLocation) lines.push(`- **Source Code**: \`${item.sourceLocation}\``)
                              if (item.url) lines.push(`- **Page URL**: ${item.url}`)
                              return lines.join("\n")
                            }),
                          ].join("\n\n"),
                          metadata: { count: items.length, annotations: items } as Record<string, unknown>,
                        }
                      }
                    }
                  } catch {
                    // Ignore connection errors during polling
                  }
                  await new Promise((resolve) => setTimeout(resolve, 2000))
                }

                return {
                  title: "Watch Timeout",
                  output: `⏳ No new annotations received within ${timeout}s.`,
                  metadata: { timeout: true, count: 0 } as Record<string, unknown>,
                }
              })
            }
          }
        }),
    }
  }),
)
