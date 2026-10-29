/**
 * SARIF 2.1.0 Exporter for Navi Pentesting Findings
 * Compatible with GitHub Code Scanning, GitLab Security, and OASIS SARIF v2.1.0.
 */

import { type ValidatedVulnerabilityFinding } from "./poc-validator"

export interface SarifLog {
  $schema: string
  version: "2.1.0"
  runs: SarifRun[]
}

export interface SarifRun {
  tool: {
    driver: {
      name: string
      version: string
      informationUri: string
      rules: SarifRule[]
    }
  }
  results: SarifResult[]
}

export interface SarifRule {
  id: string
  name: string
  shortDescription: { text: string }
  fullDescription: { text: string }
  help: { text: string; markdown: string }
  properties?: Record<string, unknown>
}

export interface SarifResult {
  ruleId: string
  level: "error" | "warning" | "note" | "none"
  message: { text: string }
  locations?: Array<{
    physicalLocation: {
      artifactLocation: { uri: string }
      region?: {
        startLine: number
        endLine?: number
        snippet?: { text: string }
      }
    }
  }>
  properties?: Record<string, unknown>
}

export function generateSarifReport(findings: ValidatedVulnerabilityFinding[]): SarifLog {
  const rulesMap = new Map<string, SarifRule>()
  const results: SarifResult[] = []

  for (const finding of findings) {
    const ruleId = finding.cwe || finding.cve || `NAVI-VULN-${finding.id}`

    if (!rulesMap.has(ruleId)) {
      rulesMap.set(ruleId, {
        id: ruleId,
        name: finding.title,
        shortDescription: { text: finding.title },
        fullDescription: { text: finding.description },
        help: {
          text: `Impact: ${finding.impact}\nRemediation: ${finding.remediation_steps}`,
          markdown: `### Impact\n${finding.impact}\n\n### Remediation\n${finding.remediation_steps}`,
        },
        properties: {
          cvss_vector: finding.canonical_vector,
          cvss_score: finding.cvss_score,
          severity: finding.severity,
        },
      })
    }

    const level: SarifResult["level"] =
      finding.severity === "critical" || finding.severity === "high"
        ? "error"
        : finding.severity === "medium"
          ? "warning"
          : "note"

    const locations = finding.code_locations?.map((loc) => ({
      physicalLocation: {
        artifactLocation: { uri: loc.file },
        region: {
          startLine: loc.start_line,
          endLine: loc.end_line,
          snippet: loc.snippet ? { text: loc.snippet } : undefined,
        },
      },
    }))

    results.push({
      ruleId,
      level,
      message: {
        text: `${finding.title}: ${finding.description}\nTarget: ${finding.target}`,
      },
      locations: locations && locations.length > 0 ? locations : undefined,
      properties: {
        findingId: finding.id,
        cvssScore: finding.cvss_score,
        canonicalVector: finding.canonical_vector,
        evidence: finding.evidence,
        pocDescription: finding.poc_description,
      },
    })
  }

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Navi Pentest Security Agent",
            version: "2.0.0",
            informationUri: "https://github.com/usestrix/strix",
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
      },
    ],
  }
}
