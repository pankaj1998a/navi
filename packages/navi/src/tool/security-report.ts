import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import {
  validateVulnerabilityFinding,
  validateDependencyFinding,
  type VulnerabilityFindingInput,
  type DependencyFindingInput,
  type ValidatedVulnerabilityFinding,
} from "@/security/poc-validator"
import { globalPentestStore } from "@/security/reporter"
import path from "node:path"
import { InstanceState } from "@/effect/instance-state"

const DESCRIPTION =
  "Strict reporting tool for validated penetration test vulnerabilities and supply chain CVEs. Enforces verified Proof-of-Concepts (PoCs), concrete execution evidence, and CVSS 3.1 scoring. Rejects unvalidated or superficial findings. Supports creation, updating, deletion, querying, and full artifact export."

export const Parameters = Schema.Struct({
  action: Schema.Literals(["create", "create_dependency", "update", "list", "get", "delete", "export", "finalize_scan"]).annotate({
    description:
      "Action to perform: 'create' (dynamic finding), 'create_dependency' (supply-chain CVE), 'update' (refine finding), 'list', 'get', 'delete', 'export', or 'finalize_scan' (set executive summary & methodology)",
  }),
  finding_id: Schema.optional(Schema.String).annotate({
    description: "Finding ID (for 'get', 'update', or 'delete')",
  }),
  data: Schema.optional(Schema.String).annotate({
    description:
      "JSON string of finding details or updates. For 'create': title, description, impact, target, technical_analysis, poc_description, poc_script_code, remediation_steps, evidence, assumptions, cvss_vector. For 'create_dependency': package_name, package_ecosystem, installed_version, fixed_version, cve, manifest_file, reachability_analysis, remediation_steps, advisory_cvss. For 'update': any partial finding fields including code_locations diffs, counterevidence, etc. For 'finalize_scan': executive_summary, methodology, strategic_recommendations",
  }),
  output_dir: Schema.optional(Schema.String).annotate({
    description: "Target directory for export (defaults to ./strix_runs/latest)",
  }),
})

export const SecurityReportTool = Tool.define(
  "security_report",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "list") {
            const findings = globalPentestStore.listFindings()
            const summary = globalPentestStore.getSummary()
            return {
              title: "Pentest Vulnerability Findings",
              output: JSON.stringify(
                {
                  summary,
                  findings: findings.map((f) => ({
                    id: f.id,
                    title: f.title,
                    severity: f.severity,
                    cvss: f.cvss_score,
                    target: f.target,
                    cwe: f.cwe,
                    cve: f.cve,
                    confidence: f.confidence,
                  })),
                },
                null,
                2,
              ),
              metadata: { total: findings.length } as Record<string, unknown>,
            }
          }

          if (params.action === "get") {
            if (!params.finding_id) {
              return {
                title: "Vulnerability Finding",
                output: "Error: 'finding_id' is required for action 'get'",
                metadata: { found: false } as Record<string, unknown>,
              }
            }
            const finding = globalPentestStore.getFinding(params.finding_id)
            if (!finding) {
              return {
                title: "Vulnerability Finding",
                output: `Finding not found: ${params.finding_id}`,
                metadata: { found: false } as Record<string, unknown>,
              }
            }
            return {
              title: `Finding ${finding.id}`,
              output: JSON.stringify(finding, null, 2),
              metadata: { found: true, id: finding.id } as Record<string, unknown>,
            }
          }

          if (params.action === "update") {
            if (!params.finding_id) {
              return {
                title: "Update Finding Error",
                output: "Error: 'finding_id' is required for action 'update'",
                metadata: { updated: false } as Record<string, unknown>,
              }
            }
            if (!params.data) {
              return {
                title: "Update Finding Error",
                output: "Error: 'data' JSON string containing updates is required for action 'update'",
                metadata: { updated: false } as Record<string, unknown>,
              }
            }

            let updates: Partial<ValidatedVulnerabilityFinding>
            try {
              updates = JSON.parse(params.data) as Partial<ValidatedVulnerabilityFinding>
            } catch (e) {
              return {
                title: "Update Finding Error",
                output: `Invalid JSON payload in 'data': ${String(e)}`,
                metadata: { updated: false } as Record<string, unknown>,
              }
            }

            const success = globalPentestStore.updateFinding(params.finding_id, updates)
            if (!success) {
              return {
                title: "Update Finding Error",
                output: `Finding not found with ID: ${params.finding_id}`,
                metadata: { updated: false } as Record<string, unknown>,
              }
            }

            const updatedFinding = globalPentestStore.getFinding(params.finding_id)
            return {
              title: `Finding Updated (${params.finding_id})`,
              output: `✅ Successfully updated finding ${params.finding_id}. Current severity: ${updatedFinding?.severity.toUpperCase()} (CVSS: ${updatedFinding?.cvss_score.toFixed(1)})`,
              metadata: { updated: true, findingId: params.finding_id } as Record<string, unknown>,
            }
          }

          if (params.action === "delete") {
            if (!params.finding_id) {
              return {
                title: "Delete Finding",
                output: "Error: 'finding_id' is required for action 'delete'",
                metadata: { deleted: false } as Record<string, unknown>,
              }
            }
            const deleted = globalPentestStore.deleteFinding(params.finding_id)
            return {
              title: "Delete Finding",
              output: deleted ? `Successfully deleted finding ${params.finding_id}` : `Finding not found: ${params.finding_id}`,
              metadata: { deleted } as Record<string, unknown>,
            }
          }

          if (params.action === "finalize_scan") {
            if (!params.data) {
              return {
                title: "Finalize Scan Error",
                output: "Error: 'data' JSON string is required with executive_summary, methodology, and/or strategic_recommendations",
                metadata: { finalized: false } as Record<string, unknown>,
              }
            }

            let summaryData: { executive_summary?: string; methodology?: string; strategic_recommendations?: string }
            try {
              summaryData = JSON.parse(params.data)
            } catch (e) {
              return {
                title: "Finalize Scan Error",
                output: `Invalid JSON payload in 'data': ${String(e)}`,
                metadata: { finalized: false } as Record<string, unknown>,
              }
            }

            globalPentestStore.updateMetadata({
              executive_summary: summaryData.executive_summary,
              methodology: summaryData.methodology,
              strategic_recommendations: summaryData.strategic_recommendations,
            })

            return {
              title: "Scan Finalized",
              output: "✅ Updated scan executive report metadata with executive summary, methodology, and strategic recommendations.",
              metadata: { finalized: true } as Record<string, unknown>,
            }
          }

          if (params.action === "export") {
            const instance = yield* InstanceState.context
            const outDir = params.output_dir
              ? path.isAbsolute(params.output_dir)
                ? params.output_dir
                : path.resolve(instance.directory, params.output_dir)
              : path.resolve(instance.directory, "strix_runs", "latest")

            const { reportPath, sarifPath, jsonPath, csvPath, coveragePath } = globalPentestStore.saveToDirectory(outDir)
            return {
              title: "Export Pentest Artifacts",
              output: [
                `✅ Exported Pentest Reports and Findings:`,
                `- Markdown Executive Report: \`${reportPath}\``,
                `- SARIF 2.1.0 (GitHub / CI Scanning): \`${sarifPath}\``,
                `- JSON Findings: \`${jsonPath}\``,
                `- CSV Index (CWE-1236 Formula-Safe): \`${csvPath}\``,
                `- Attack Surface Coverage: \`${coveragePath}\``,
                `- Individual PoCs: \`${path.join(outDir, "vulnerabilities")}\``,
              ].join("\n"),
              metadata: { outDir, totalFindings: globalPentestStore.listFindings().length } as Record<string, unknown>,
            }
          }

          if (params.action === "create") {
            if (!params.data) {
              return {
                title: "Create Vulnerability Finding",
                output: "Error: 'data' JSON string is required for action 'create'",
                metadata: { created: false } as Record<string, unknown>,
              }
            }

            let parsed: VulnerabilityFindingInput
            try {
              parsed = JSON.parse(params.data) as VulnerabilityFindingInput
            } catch (e) {
              return {
                title: "Create Vulnerability Finding",
                output: `Invalid JSON payload in 'data': ${String(e)}`,
                metadata: { created: false } as Record<string, unknown>,
              }
            }

            const validation = validateVulnerabilityFinding(parsed)
            if (!validation.valid) {
              return {
                title: "Vulnerability Report Rejected",
                output: [
                  `❌ REJECTED: Finding failed strict PoC validation standard:`,
                  ...validation.errors.map((err) => `  - ${err}`),
                  "",
                  `Requirements: Working PoC code/script, concrete execution evidence, technical analysis, impact, assumptions, and valid CVSS 3.1 vector.`,
                ].join("\n"),
                metadata: { created: false, errors: validation.errors } as Record<string, unknown>,
              }
            }

            const dedupe = globalPentestStore.addFinding(validation.finding)
            if (dedupe.isDuplicate) {
              return {
                title: "Duplicate Vulnerability Finding",
                output: `⚠️ **DUPLICATE FINDING**: Finding matches existing record ${dedupe.originalFindingId} (${dedupe.reason}). Merged with existing record.`,
                metadata: { isDuplicate: true, originalId: dedupe.originalFindingId } as Record<string, unknown>,
              }
            }

            return {
              title: `Vulnerability Finding Recorded (${validation.finding.id})`,
              output: [
                `✅ **Verified Finding Recorded**`,
                `- **ID**: \`${validation.finding.id}\``,
                `- **Title**: ${validation.finding.title}`,
                `- **Severity**: **${validation.finding.severity.toUpperCase()}** (CVSS: ${validation.finding.cvss_score.toFixed(1)})`,
                `- **Vector**: \`${validation.finding.canonical_vector}\``,
                `- **Target**: \`${validation.finding.target}\``,
                `- **CWE**: ${validation.finding.cwe || "N/A"}`,
                `- **PoC**: Verified executable reproduction attached.`,
              ].join("\n"),
              metadata: { findingId: validation.finding.id, severity: validation.finding.severity } as Record<string, unknown>,
            }
          }

          if (params.action === "create_dependency") {
            if (!params.data) {
              return {
                title: "Create Dependency Report Error",
                output: "Error: 'data' JSON string is required for action 'create_dependency'",
                metadata: { created: false } as Record<string, unknown>,
              }
            }

            let parsedDep: DependencyFindingInput
            try {
              parsedDep = JSON.parse(params.data) as DependencyFindingInput
            } catch (e) {
              return {
                title: "Create Dependency Report Error",
                output: `Invalid JSON payload in 'data': ${String(e)}`,
                metadata: { created: false } as Record<string, unknown>,
              }
            }

            const validation = validateDependencyFinding(parsedDep)
            if (!validation.valid) {
              return {
                title: "Dependency Report Rejected",
                output: [
                  `❌ REJECTED: Dependency CVE finding invalid:`,
                  ...validation.errors.map((err) => `  - ${err}`),
                ].join("\n"),
                metadata: { created: false, errors: validation.errors } as Record<string, unknown>,
              }
            }

            const dedupe = globalPentestStore.addFinding(validation.finding)
            if (dedupe.isDuplicate) {
              return {
                title: "Duplicate Dependency Finding",
                output: `⚠️ **DUPLICATE DEPENDENCY CVE**: Finding matches existing record ${dedupe.originalFindingId} (${dedupe.reason})`,
                metadata: { isDuplicate: true, originalId: dedupe.originalFindingId } as Record<string, unknown>,
              }
            }

            return {
              title: `Dependency Finding Recorded (${validation.finding.id})`,
              output: [
                `✅ **Supply-Chain Dependency CVE Recorded**`,
                `- **ID**: \`${validation.finding.id}\``,
                `- **Package**: \`${parsedDep.package_name}@${parsedDep.installed_version}\``,
                `- **CVE**: \`${validation.finding.cve}\``,
                `- **Severity**: **${validation.finding.severity.toUpperCase()}** (CVSS: ${validation.finding.cvss_score.toFixed(1)})`,
                `- **Manifest**: \`${parsedDep.manifest_file}\``,
                `- **Fixed In**: \`${parsedDep.fixed_version || "N/A"}\``,
                `- **Reachability Analysis**: ${parsedDep.reachability_analysis.slice(0, 150)}...`,
              ].join("\n"),
              metadata: { findingId: validation.finding.id, cve: validation.finding.cve } as Record<string, unknown>,
            }
          }

          return {
            title: "Security Report Tool",
            output: `Unknown action: ${params.action}`,
            metadata: {} as Record<string, unknown>,
          }
        }),
    }
  }),
)
