/**
 * Pentest Report Generator & Run State Manager
 * Generates executive summaries, detailed PoCs, compliance-ready Markdown reports,
 * OASIS SARIF 2.1.0, and CSV exports with formula injection mitigation (CWE-1236).
 */

import { type ValidatedVulnerabilityFinding } from "./poc-validator"
import { generateSarifReport } from "./sarif"
import { checkDuplicate, type DedupeResult } from "./dedupe"
import { globalCoverageStore } from "./coverage"
import fs from "fs"
import path from "path"

export interface ScanRunMetadata {
  runId: string
  target: string
  scanMode: "quick" | "standard" | "deep" | "diff"
  startedAt: string
  finishedAt?: string
  totalBudget?: number
  costSpent?: number
  tokensUsed?: number
  executive_summary?: string
  methodology?: string
  strategic_recommendations?: string
}

const CSV_FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"]

export function csvSafe(value: unknown): string {
  if (value === null || value === undefined) return '""'
  let text = String(value)
  if (CSV_FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = "'" + text
  }
  return `"${text.replace(/"/g, '""')}"`
}

export class PentestReportStore {
  private findings: Map<string, ValidatedVulnerabilityFinding> = new Map()
  private metadata: ScanRunMetadata

  constructor(target: string, scanMode: "quick" | "standard" | "deep" | "diff" = "standard") {
    this.metadata = {
      runId: `run-${Date.now().toString(36)}`,
      target,
      scanMode,
      startedAt: new Date().toISOString(),
    }
  }

  updateMetadata(data: Partial<ScanRunMetadata>): void {
    this.metadata = {
      ...this.metadata,
      ...data,
    }
  }

  addFinding(finding: ValidatedVulnerabilityFinding): DedupeResult {
    const existing = this.listFindings()
    const dedupe = checkDuplicate(finding, existing)
    if (dedupe.isDuplicate) {
      return dedupe
    }
    this.findings.set(finding.id, finding)
    return { isDuplicate: false }
  }

  updateFinding(id: string, updates: Partial<ValidatedVulnerabilityFinding>): boolean {
    const existing = this.findings.get(id)
    if (!existing) return false
    this.findings.set(id, {
      ...existing,
      ...updates,
      id: existing.id,
      created_at: existing.created_at,
    })
    return true
  }

  getFinding(id: string): ValidatedVulnerabilityFinding | undefined {
    return this.findings.get(id)
  }

  listFindings(): ValidatedVulnerabilityFinding[] {
    return Array.from(this.findings.values()).sort((a, b) => b.cvss_score - a.cvss_score)
  }

  deleteFinding(id: string): boolean {
    return this.findings.delete(id)
  }

  getSummary() {
    const all = this.listFindings()
    return {
      total: all.length,
      critical: all.filter((f) => f.severity === "critical").length,
      high: all.filter((f) => f.severity === "high").length,
      medium: all.filter((f) => f.severity === "medium").length,
      low: all.filter((f) => f.severity === "low").length,
      none: all.filter((f) => f.severity === "none").length,
    }
  }

  generateCsv(): string {
    const all = this.listFindings()
    const headers = ["id", "title", "severity", "cvss_score", "cwe", "cve", "target", "confidence", "fix_effort", "created_at", "file"]
    const rows = [headers.join(",")]

    for (const f of all) {
      const row = [
        csvSafe(f.id),
        csvSafe(f.title),
        csvSafe(f.severity.toUpperCase()),
        csvSafe(f.cvss_score.toFixed(1)),
        csvSafe(f.cwe || "N/A"),
        csvSafe(f.cve || "N/A"),
        csvSafe(f.target),
        csvSafe(f.confidence || "high"),
        csvSafe(f.fix_effort || "medium"),
        csvSafe(f.created_at),
        csvSafe(`vulnerabilities/${f.id}.md`),
      ]
      rows.push(row.join(","))
    }

    return rows.join("\r\n")
  }

  generateMarkdownReport(): string {
    const summary = this.getSummary()
    const all = this.listFindings()

    const lines: string[] = [
      `# 🛡️ Autonomous AI Penetration Test Report`,
      `**Target**: \`${this.metadata.target}\``,
      `**Run ID**: \`${this.metadata.runId}\` | **Scan Mode**: \`${this.metadata.scanMode}\``,
      `**Generated At**: ${new Date().toISOString()}`,
      "",
      `---`,
      "",
      `## 1. Executive Summary`,
      this.metadata.executive_summary ||
        `The autonomous AI penetration testing system assessed the target against the OWASP Top 10, business logic vulnerabilities, and modern application attack surfaces.\nAll reported findings below have been **verified with reproducible Proof-of-Concept exploits**.`,
      "",
      `| Severity | Count |`,
      `| :--- | :--- |`,
      `| 🔴 **Critical** | ${summary.critical} |`,
      `| 🟠 **High** | ${summary.high} |`,
      `| 🟡 **Medium** | ${summary.medium} |`,
      `| 🔵 **Low** | ${summary.low} |`,
      `| **Total Findings** | **${summary.total}** |`,
      "",
      `---`,
      "",
    ]

    if (this.metadata.methodology) {
      lines.push(`## 2. Assessment Methodology`, this.metadata.methodology, "", `---`, "")
    }

    const findingSectionNum = this.metadata.methodology ? 3 : 2
    lines.push(`## ${findingSectionNum}. Validated Vulnerability Findings`, "")

    if (all.length === 0) {
      lines.push("✅ **No exploitable vulnerabilities verified during this engagement.**")
      return lines.join("\n")
    }

    let i = 1
    for (const f of all) {
      const icon =
        f.severity === "critical"
          ? "🔴 [CRITICAL]"
          : f.severity === "high"
            ? "🟠 [HIGH]"
            : f.severity === "medium"
              ? "🟡 [MEDIUM]"
              : "🔵 [LOW]"

      lines.push(`### ${i++}. ${icon} ${f.title} (${f.id})`)
      lines.push(`- **CVSS Score**: **${f.cvss_score.toFixed(1)}** (\`${f.canonical_vector}\`)`)
      if (f.cwe) lines.push(`- **CWE**: ${f.cwe}`)
      if (f.cve) lines.push(`- **CVE**: ${f.cve}`)
      lines.push(`- **Target**: \`${f.target}\``)
      lines.push(`- **Confidence**: ${f.confidence ?? "high"}`)
      if (f.confidence_rationale) lines.push(`- **Confidence Rationale**: ${f.confidence_rationale}`)
      lines.push(`- **Remediation Effort**: ${f.fix_effort ?? "medium"}`)
      if (f.severity_change_conditions) lines.push(`- **Severity Change Conditions**: ${f.severity_change_conditions}`)
      lines.push("")
      lines.push(`#### Description & Impact`)
      lines.push(f.description)
      lines.push("")
      lines.push(`**Impact**: ${f.impact}`)
      lines.push("")
      lines.push(`#### Technical Analysis & Exploitation Mechanics`)
      lines.push(f.technical_analysis)
      lines.push("")
      if (f.counterevidence) {
        lines.push(`#### Counterevidence & Exploit Prerequisites`)
        lines.push(f.counterevidence)
        lines.push("")
      }
      lines.push(`#### Concrete Evidence`)
      lines.push(`\`\`\`\n${f.evidence}\n\`\`\``)
      lines.push("")
      lines.push(`#### Verified Proof of Concept (PoC)`)
      lines.push(f.poc_description)
      lines.push("")
      lines.push(`\`\`\`bash\n${f.poc_script_code}\n\`\`\``)
      lines.push("")
      lines.push(`#### Remediation Guidance`)
      lines.push(f.remediation_steps)
      lines.push("")
      if (f.fix_verification) {
        lines.push(`#### Fix Verification`)
        lines.push(f.fix_verification)
        lines.push("")
      }
      if (f.fix_pr_body) {
        lines.push(`#### Suggested Fix PR`)
        lines.push(`\`\`\`markdown\n${f.fix_pr_body}\n\`\`\``)
        lines.push("")
      }
      if (f.code_locations && f.code_locations.length > 0) {
        lines.push(`#### Affected Code Locations & Suggested Patches`)
        for (const loc of f.code_locations) {
          lines.push(`- \`${loc.file}:${loc.start_line}-${loc.end_line}\`${loc.label ? ` (${loc.label})` : ""}`)
          if (loc.snippet) {
            lines.push(`  \`\`\`\n  ${loc.snippet}\n  \`\`\``)
          }
          if (loc.fix_before || loc.fix_after) {
            lines.push("  **Diff Patch:**")
            lines.push("```diff")
            if (loc.fix_before) {
              for (const ln of loc.fix_before.split("\n")) {
                lines.push(`- ${ln}`)
              }
            }
            if (loc.fix_after) {
              for (const ln of loc.fix_after.split("\n")) {
                lines.push(`+ ${ln}`)
              }
            }
            lines.push("```")
          }
        }
        lines.push("")
      }
      lines.push("---")
      lines.push("")
    }

    if (this.metadata.strategic_recommendations) {
      lines.push(`## ${findingSectionNum + 1}. Strategic Recommendations`, this.metadata.strategic_recommendations, "")
    }

    return lines.join("\n")
  }

  saveToDirectory(outputDir: string): { reportPath: string; sarifPath: string; jsonPath: string; csvPath: string; coveragePath: string } {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const reportPath = path.join(outputDir, "penetration_test_report.md")
    fs.writeFileSync(reportPath, this.generateMarkdownReport(), "utf-8")

    const sarifPath = path.join(outputDir, "findings.sarif")
    fs.writeFileSync(sarifPath, JSON.stringify(generateSarifReport(this.listFindings()), null, 2), "utf-8")

    const jsonPath = path.join(outputDir, "vulnerabilities.json")
    fs.writeFileSync(jsonPath, JSON.stringify(this.listFindings(), null, 2), "utf-8")

    const csvPath = path.join(outputDir, "vulnerabilities.csv")
    fs.writeFileSync(csvPath, this.generateCsv(), "utf-8")

    const coveragePath = path.join(outputDir, "coverage.json")
    fs.writeFileSync(
      coveragePath,
      JSON.stringify(
        {
          summary: globalCoverageStore.getSummary(),
          entries: globalCoverageStore.list(),
        },
        null,
        2,
      ),
      "utf-8",
    )

    const runPath = path.join(outputDir, "run.json")
    fs.writeFileSync(
      runPath,
      JSON.stringify(
        {
          ...this.metadata,
          finishedAt: new Date().toISOString(),
          summary: this.getSummary(),
        },
        null,
        2,
      ),
      "utf-8",
    )

    // Save individual vulnerability PoC files in vulnerabilities/
    const vulnsDir = path.join(outputDir, "vulnerabilities")
    if (!fs.existsSync(vulnsDir)) {
      fs.mkdirSync(vulnsDir, { recursive: true })
    }
    for (const f of this.listFindings()) {
      const vulnFile = path.join(vulnsDir, `${f.id}.md`)
      const diffSections = (f.code_locations || [])
        .filter((loc) => loc.fix_before || loc.fix_after)
        .map(
          (loc) =>
            `### Suggested Patch for \`${loc.file}\`\n\`\`\`diff\n${(loc.fix_before || "")
              .split("\n")
              .map((l) => `- ${l}`)
              .join("\n")}\n${(loc.fix_after || "")
              .split("\n")
              .map((l) => `+ ${l}`)
              .join("\n")}\n\`\`\``,
        )
        .join("\n\n")

      fs.writeFileSync(
        vulnFile,
        `# ${f.title}\n\n**ID**: ${f.id}\n**Severity**: ${f.severity.toUpperCase()} (CVSS: ${f.cvss_score.toFixed(1)})\n**Target**: \`${f.target}\`\n\n## Technical Analysis\n${f.technical_analysis}\n\n## Verified Proof of Concept\n\`\`\`bash\n${f.poc_script_code}\n\`\`\`\n\n## Evidence\n\`\`\`\n${f.evidence}\n\`\`\`\n\n## Remediation\n${f.remediation_steps}\n\n${diffSections ? `${diffSections}\n` : ""}`,
        "utf-8",
      )
    }

    return { reportPath, sarifPath, jsonPath, csvPath, coveragePath }
  }
}

// Global active store instance per scan session
export const globalPentestStore = new PentestReportStore("workspace", "standard")
