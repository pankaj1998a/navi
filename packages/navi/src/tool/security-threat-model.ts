import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { globalThreatModelStore, type ThreatItem } from "@/security/threat-model"

const DESCRIPTION =
  "Threat modeling tool. Decomposes application architecture, establishes trust boundaries, catalogs STRIDE threats, enforces severity calibration, and records dynamic amendments during testing."

export const Parameters = Schema.Struct({
  action: Schema.Literals(["get", "save_overview", "save_document", "add_threat", "amend"]).annotate({
    description: "Action to perform: 'get', 'save_overview', 'save_document' (full markdown), 'add_threat', or 'amend'",
  }),
  target: Schema.optional(Schema.String).annotate({
    description: "Target URL or component scope (e.g. 'https://api.example.com' or 'workspace')",
  }),
  content: Schema.optional(Schema.String).annotate({
    description:
      "Full markdown threat model document for 'save_document'. Must cover: Overview, Trust Boundaries, Attack Surface, and Severity Calibration.",
  }),
  overview: Schema.optional(Schema.String).annotate({
    description: "High-level application architecture and dataflow description",
  }),
  trust_boundaries: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "List of trust boundaries (e.g. ['Client -> Reverse Proxy', 'API -> Database'])",
  }),
  assets: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Critical assets to protect (e.g. ['JWT Secret', 'User PII', 'Payment Tokens'])",
  }),
  attack_surface: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Exposed endpoints, services, or protocols comprising the attack surface",
  }),
  severity_calibration: Schema.optional(Schema.String).annotate({
    description: "Rules for what counts as Critical vs High vs Medium in this specific target's context",
  }),
  amendment: Schema.optional(Schema.String).annotate({
    description: "Amendment text or newly discovered trust boundary/observation (for 'amend')",
  }),
  threat: Schema.optional(
    Schema.Struct({
      category: Schema.Literals(["spoofing", "tampering", "repudiation", "info_disclosure", "dos", "elevation_of_privilege"]),
      title: Schema.String,
      description: Schema.String,
      affected_component: Schema.String,
      prerequisites: Schema.String,
      potential_impact: Schema.String,
      mitigation: Schema.String,
      status: Schema.Literals(["unmitigated", "partially_mitigated", "verified_exploitable", "mitigated"]),
    }),
  ).annotate({
    description: "Individual STRIDE threat details (for 'add_threat')",
  }),
})

export const SecurityThreatModelTool = Tool.define(
  "security_threat_model",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const target = params.target || "workspace"

          if (params.action === "get") {
            const current = globalThreatModelStore.get(target)
            return {
              title: `Threat Model (${current.target || "workspace"})`,
              output: JSON.stringify(current, null, 2),
              metadata: {
                target: current.target,
                threatsCount: current.threats.length,
                amendmentsCount: current.amendments.length,
              } as Record<string, unknown>,
            }
          }

          if (params.action === "save_document") {
            if (!params.content) {
              return {
                title: "Save Document Error",
                output: "Error: 'content' markdown string is required for action 'save_document'",
                metadata: { saved: false } as Record<string, unknown>,
              }
            }
            const res = globalThreatModelStore.saveMarkdownContent(params.content, target)
            const warning =
              res.missingSections && res.missingSections.length > 0
                ? `\n⚠️ Note: The document lacks standard sections: ${res.missingSections.join(", ")}`
                : ""
            return {
              title: "Threat Model Document Saved",
              output: `✅ Saved complete threat model document for target \`${target}\`. Length: ${params.content.length} characters.${warning}`,
              metadata: { saved: true, length: params.content.length } as Record<string, unknown>,
            }
          }

          if (params.action === "save_overview") {
            const updated = globalThreatModelStore.save(
              {
                application_overview: params.overview,
                trust_boundaries: params.trust_boundaries ? [...params.trust_boundaries] : undefined,
                assets: params.assets ? [...params.assets] : undefined,
                attack_surface: params.attack_surface ? [...params.attack_surface] : undefined,
                severity_calibration: params.severity_calibration,
              },
              target,
            )
            return {
              title: "Threat Model Overview Saved",
              output: `✅ Threat model overview updated for \`${target}\`: ${updated.trust_boundaries.length} trust boundaries, ${updated.assets.length} critical assets.`,
              metadata: { updated: true } as Record<string, unknown>,
            }
          }

          if (params.action === "add_threat") {
            if (!params.threat) {
              return {
                title: "Add Threat Error",
                output: "Error: 'threat' object is required for action 'add_threat'",
                metadata: { success: false } as Record<string, unknown>,
              }
            }

            const item = globalThreatModelStore.addThreat(params.threat as Omit<ThreatItem, "id">, target)
            return {
              title: `Threat Recorded (${item.id})`,
              output: `✅ Recorded ${item.category.toUpperCase()} Threat on \`${target}\`: "${item.title}" on component \`${item.affected_component}\` [Status: ${item.status}]`,
              metadata: { id: item.id, category: item.category } as Record<string, unknown>,
            }
          }

          if (params.action === "amend") {
            if (!params.amendment) {
              return {
                title: "Amend Error",
                output: "Error: 'amendment' text is required for action 'amend'",
                metadata: { success: false } as Record<string, unknown>,
              }
            }
            const record = globalThreatModelStore.amend(params.amendment, undefined, target)
            return {
              title: `Threat Model Amended (${target})`,
              output: `✅ Recorded threat model amendment for \`${target}\` at ${record.timestamp}: "${record.note}"`,
              metadata: { amendment: record } as Record<string, unknown>,
            }
          }

          return {
            title: "Security Threat Model",
            output: `Unknown action: ${params.action}`,
            metadata: {} as Record<string, unknown>,
          }
        }),
    }
  }),
)
