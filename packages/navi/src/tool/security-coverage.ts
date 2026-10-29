import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { globalCoverageStore, type CoverageStatus } from "@/security/coverage"

const DESCRIPTION =
  "Attack surface coverage tracking tool. Records endpoints, parameters, and testing status (including negative space outcomes: reported, no_issue_found, ruled_out, not_applicable, needs_follow_up) to eliminate blind spots."

export const Parameters = Schema.Struct({
  action: Schema.Literals(["record", "list", "summary"]).annotate({
    description: "Action to perform: 'record', 'list', or 'summary'",
  }),
  asset: Schema.optional(Schema.String).annotate({
    description: "Target asset name or domain (e.g. 'api.example.com' or 'auth-service')",
  }),
  method: Schema.optional(Schema.String).annotate({
    description: "HTTP Method (e.g. 'GET', 'POST', 'PUT', 'DELETE')",
  }),
  endpoint: Schema.optional(Schema.String).annotate({
    description: "Endpoint path or URL (e.g. '/api/v1/users/:id')",
  }),
  parameters: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "List of parameters tested (e.g. ['id', 'role', 'redirect_uri'])",
  }),
  status: Schema.optional(
    Schema.Literals([
      "discovered",
      "in_progress",
      "tested",
      "vulnerable",
      "reported",
      "no_issue_found",
      "ruled_out",
      "not_applicable",
      "needs_follow_up",
    ]),
  ).annotate({
    description: "Testing status or outcome for this surface",
  }),
  tested_vulnerability_types: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Vulnerability classes tested (e.g. ['sqli', 'idor', 'xss', 'ssrf'])",
  }),
  evidence: Schema.optional(Schema.String).annotate({
    description: "Concrete testing evidence or reasoning why an outcome was reached (e.g. reason for ruled_out)",
  }),
  notes: Schema.optional(Schema.String).annotate({
    description: "Contextual testing observations",
  }),
})

export const SecurityCoverageTool = Tool.define(
  "security_coverage",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "summary") {
            const summary = globalCoverageStore.getSummary()
            return {
              title: "Attack Surface Coverage Summary",
              output: JSON.stringify(summary, null, 2),
              metadata: { totalEndpoints: summary.totalEndpoints } as Record<string, unknown>,
            }
          }

          if (params.action === "list") {
            const all = globalCoverageStore.list()
            return {
              title: "Attack Surface Coverage",
              output: JSON.stringify(all, null, 2),
              metadata: { total: all.length } as Record<string, unknown>,
            }
          }

          if (params.action === "record") {
            if (!params.endpoint) {
              return {
                title: "Coverage Record Error",
                output: "Error: 'endpoint' is required for action 'record'",
                metadata: { recorded: false } as Record<string, unknown>,
              }
            }

            const recorded = globalCoverageStore.record({
              asset: params.asset || "default",
              method: params.method || "GET",
              endpoint: params.endpoint,
              parameters: params.parameters ? [...params.parameters] : [],
              status: (params.status as CoverageStatus) || "discovered",
              tested_vulnerability_types: params.tested_vulnerability_types ? [...params.tested_vulnerability_types] : [],
              evidence: params.evidence,
              notes: params.notes,
            })

            return {
              title: `Coverage Recorded (${recorded.method} ${recorded.endpoint})`,
              output: `✅ Recorded ${recorded.method} ${recorded.endpoint} [Status: ${recorded.status}] with ${recorded.tested_vulnerability_types.length} test categories.`,
              metadata: { recorded: true, id: recorded.id } as Record<string, unknown>,
            }
          }

          return {
            title: "Security Coverage",
            output: `Unknown action: ${params.action}`,
            metadata: {} as Record<string, unknown>,
          }
        }),
    }
  }),
)
