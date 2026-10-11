import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "node:path"
import { scanWorkspace, type Severity } from "@/security/sast"
import { auditWorkspaceSupplyChain } from "@/security/supplychain"

const DESCRIPTION =
  "Runs multi-language SAST vulnerability scanning, secret detection, and supply chain security analysis across the codebase."

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "Directory or file path to scan (defaults to current workspace)",
  }),
  severity: Schema.optional(Schema.Literals(["critical", "high", "medium", "low", "all"])).annotate({
    description: "Minimum severity threshold to report (default: all)",
  }),
  include_supply_chain: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to include package.json and Dockerfile supply-chain audits (default: true)",
  }),
  format: Schema.optional(Schema.Literals(["markdown", "json"])).annotate({
    description: "Output format: 'markdown' for human reading or 'json' for structured reporting",
  }),
})

export const SecurityScanTool = Tool.define(
  "security_scan",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const targetDir = params.path
            ? path.isAbsolute(params.path)
              ? params.path
              : path.resolve(instance.directory, params.path)
            : instance.directory

          const severityFilter: Severity[] | undefined =
            !params.severity || params.severity === "all"
              ? undefined
              : params.severity === "critical"
                ? ["critical"]
                : params.severity === "high"
                  ? ["critical", "high"]
                  : params.severity === "medium"
                    ? ["critical", "high", "medium"]
                    : ["critical", "high", "medium", "low", "info"]

          const sastResult = scanWorkspace(targetDir, { severityFilter })
          const supplyChainFindings =
            params.include_supply_chain !== false ? auditWorkspaceSupplyChain(targetDir) : []

          if (params.format === "json") {
            const combined = {
              target: targetDir,
              scannedFiles: sastResult.scannedFiles,
              sastFindings: sastResult.findings,
              supplyChainFindings,
              summary: {
                ...sastResult.summary,
                supplyChain: supplyChainFindings.length,
              },
            }
            return {
              title: "Security Scan",
              output: JSON.stringify(combined, null, 2),
              metadata: { totalFindings: sastResult.findings.length + supplyChainFindings.length } as Record<string, unknown>,
            }
          }

          const lines: string[] = [
            `# 🛡️ Navi Cybersecurity Scan Report`,
            `* Target: \`${path.basename(targetDir)}\` (\`${targetDir}\`)`,
            `* Files Scanned: ${sastResult.scannedFiles}`,
            `* Total Findings: ${sastResult.summary.total + supplyChainFindings.length} (${sastResult.summary.critical} Critical, ${sastResult.summary.high} High, ${sastResult.summary.medium} Medium, ${sastResult.summary.low} Low, ${supplyChainFindings.length} Supply Chain)`,
            "",
          ]

          if (sastResult.findings.length === 0 && supplyChainFindings.length === 0) {
            lines.push("✅ **No vulnerabilities or security issues identified.** Codebase adheres to security baselines.")
          } else {
            if (sastResult.findings.length > 0) {
              lines.push("## ⚠️ SAST & Code Security Findings", "")
              for (const f of sastResult.findings.slice(0, 50)) {
                const icon =
                  f.severity === "critical"
                    ? "🔴 [CRITICAL]"
                    : f.severity === "high"
                      ? "🟠 [HIGH]"
                      : f.severity === "medium"
                        ? "🟡 [MEDIUM]"
                        : "🔵 [LOW]"

                lines.push(`### ${icon} ${f.title} (${f.cwe})`)
                lines.push(`- **Location**: \`${f.file}:${f.line}\``)
                lines.push(`- **OWASP Category**: ${f.owasp}`)
                lines.push(`- **Code Snippet**: \`${f.snippet}\``)
                lines.push(`- **Vulnerability**: ${f.description}`)
                lines.push(`- **Remediation**: ${f.remediation}`)
                lines.push("")
              }
              if (sastResult.findings.length > 50) {
                lines.push(`*(...${sastResult.findings.length - 50} additional findings truncated)*`)
              }
            }

            if (supplyChainFindings.length > 0) {
              lines.push("## 📦 Supply Chain & Container Findings", "")
              for (const sc of supplyChainFindings) {
                lines.push(`### ⚠️ [${sc.severity.toUpperCase()}] ${sc.title}`)
                lines.push(`- **File**: \`${sc.target}\`${sc.package ? ` (package: \`${sc.package}@${sc.version}\`)` : ""}`)
                lines.push(`- **Risk**: ${sc.description}`)
                lines.push(`- **Fix**: ${sc.remediation}`)
                lines.push("")
              }
            }
          }

          return {
            title: `Security Scan: ${path.basename(targetDir)}`,
            output: lines.join("\n"),
            metadata: {
              totalFindings: sastResult.summary.total + supplyChainFindings.length,
              critical: sastResult.summary.critical,
              high: sastResult.summary.high,
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)
