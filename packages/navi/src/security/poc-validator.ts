/**
 * Strict Vulnerability Finding & PoC Validation Engine
 * Modeled after Strix's verification standard: zero hallucinated findings.
 * Supports both dynamic exploit findings (create_vulnerability_report)
 * and supply-chain known CVE findings (create_dependency_report).
 */

import { calculateCvss, type CvssV31Vector, type SeverityLevel } from "./cvss"

export interface CodeLocation {
  file: string
  start_line: number
  end_line: number
  snippet?: string
  label?: string
  fix_before?: string
  fix_after?: string
}

export interface VulnerabilityFindingInput {
  finding_class?: "vulnerability" | "dependency_cve"
  title: string
  description: string
  impact: string
  target: string
  technical_analysis: string
  poc_description: string
  poc_script_code: string
  remediation_steps: string
  evidence: string
  assumptions: string
  cwe?: string
  cve?: string
  cvss_vector: CvssV31Vector
  confidence?: "high" | "medium" | "low"
  confidence_rationale?: string
  severity_change_conditions?: string
  fix_effort?: "trivial" | "low" | "medium" | "high"
  fix_verification?: string
  fix_pr_body?: string
  counterevidence?: string
  code_locations?: CodeLocation[]
  http_exchange_ids?: string[]
}

export interface DependencyFindingInput {
  package_name: string
  package_ecosystem: "npm" | "pypi" | "cargo" | "golang" | "maven" | "composer" | "other"
  installed_version: string
  fixed_version?: string
  cve: string
  manifest_file: string
  reachability_analysis: string
  remediation_steps: string
  advisory_url?: string
  advisory_cvss?: number
  is_direct?: boolean
  dependency_path?: string
}

export interface ValidatedVulnerabilityFinding extends VulnerabilityFindingInput {
  id: string
  cvss_score: number
  severity: SeverityLevel
  canonical_vector: string
  created_at: string
  finding_class: "vulnerability" | "dependency_cve"
  dependency_metadata?: DependencyFindingInput
}

const REQUIRED_TEXT_FIELDS: Partial<Record<keyof VulnerabilityFindingInput, string>> = {
  title: "Title cannot be empty",
  description: "Description cannot be empty",
  impact: "Impact cannot be empty",
  target: "Target cannot be empty",
  technical_analysis: "Technical analysis cannot be empty",
  poc_description: "PoC description cannot be empty",
  poc_script_code: "PoC script/code is REQUIRED - provide the actual exploit/payload",
  remediation_steps: "Remediation steps cannot be empty",
  evidence: "Evidence cannot be empty - provide concrete proof of the finding",
  assumptions: "Assumptions cannot be empty - state exploitability prerequisites",
}

export function validateVulnerabilityFinding(
  input: VulnerabilityFindingInput,
): { valid: true; finding: ValidatedVulnerabilityFinding } | { valid: false; errors: string[] } {
  const errors: string[] = []

  // 1. Check all required text fields
  for (const [key, msg] of Object.entries(REQUIRED_TEXT_FIELDS)) {
    if (msg) {
      const val = (input as unknown as Record<string, unknown>)[key]
      if (!val || typeof val !== "string" || !val.trim()) {
        errors.push(msg)
      }
    }
  }

  // 2. Validate CWE if present
  let normalizedCwe = input.cwe?.trim()
  if (normalizedCwe) {
    const match = normalizedCwe.match(/CWE-\d+/)
    if (match) {
      normalizedCwe = match[0]
    } else {
      errors.push(`Invalid CWE format: '${normalizedCwe}' (expected 'CWE-NNN')`)
    }
  }

  // 3. Validate CVE if present
  let normalizedCve = input.cve?.trim()
  if (normalizedCve) {
    const match = normalizedCve.match(/CVE-\d{4}-\d{4,}/)
    if (match) {
      normalizedCve = match[0]
    } else {
      errors.push(`Invalid CVE format: '${normalizedCve}' (expected 'CVE-YYYY-NNNNN')`)
    }
  }

  // 4. Validate Code Locations
  if (input.code_locations && Array.isArray(input.code_locations)) {
    let i = 0
    for (const loc of input.code_locations) {
      if (!loc.file || !loc.file.trim()) {
        errors.push(`code_locations[${i}]: file path cannot be empty`)
      }
      if (typeof loc.start_line !== "number" || loc.start_line < 1) {
        errors.push(`code_locations[${i}]: start_line must be a positive integer`)
      }
      if (typeof loc.end_line !== "number" || loc.end_line < (loc.start_line || 1)) {
        errors.push(`code_locations[${i}]: end_line must be >= start_line`)
      }
      i++
    }
  }

  // 5. Validate CVSS Vector & calculate score
  let cvssResult: ReturnType<typeof calculateCvss>
  try {
    cvssResult = calculateCvss(input.cvss_vector)
  } catch (err) {
    errors.push(`Failed to calculate CVSS vector: ${String(err)}`)
    return { valid: false, errors }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  const id = `VULN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`

  return {
    valid: true,
    finding: {
      ...input,
      id,
      finding_class: "vulnerability",
      cwe: normalizedCwe,
      cve: normalizedCve,
      cvss_score: cvssResult.score,
      severity: cvssResult.severity,
      canonical_vector: cvssResult.vector,
      created_at: new Date().toISOString(),
    },
  }
}

export function validateDependencyFinding(
  input: DependencyFindingInput,
): { valid: true; finding: ValidatedVulnerabilityFinding } | { valid: false; errors: string[] } {
  const errors: string[] = []

  if (!input.package_name?.trim()) errors.push("package_name cannot be empty")
  if (!input.installed_version?.trim()) errors.push("installed_version cannot be empty")
  if (!input.manifest_file?.trim()) errors.push("manifest_file cannot be empty")
  if (!input.reachability_analysis?.trim()) errors.push("reachability_analysis is required")
  if (!input.remediation_steps?.trim()) errors.push("remediation_steps cannot be empty")

  let cve = input.cve?.trim() || ""
  const cveMatch = cve.match(/CVE-\d{4}-\d{4,}/)
  if (!cveMatch) {
    errors.push(`Invalid CVE identifier: '${input.cve}' (must match CVE-YYYY-NNNNN)`)
  } else {
    cve = cveMatch[0]
  }

  const advisoryCvss = input.advisory_cvss || 7.5
  let severity: SeverityLevel = "high"
  if (advisoryCvss >= 9.0) severity = "critical"
  else if (advisoryCvss >= 7.0) severity = "high"
  else if (advisoryCvss >= 4.0) severity = "medium"
  else severity = "low"

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  const id = `DEP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`

  return {
    valid: true,
    finding: {
      id,
      finding_class: "dependency_cve",
      title: `${cve} in ${input.package_name}@${input.installed_version}`,
      description: `Known vulnerable dependency ${input.package_name} version ${input.installed_version} pinned in ${input.manifest_file}.`,
      impact: `Known CVE with CVSS ${advisoryCvss.toFixed(1)}. Fixed in ${input.fixed_version || "latest release"}.`,
      target: `${input.manifest_file} (${input.package_name}@${input.installed_version})`,
      technical_analysis: input.reachability_analysis,
      poc_description: `Supply chain dependency check in ${input.manifest_file}`,
      poc_script_code: `# Pinned in ${input.manifest_file}\ngrep -n -C 2 '${input.package_name}' ${input.manifest_file}`,
      remediation_steps: input.remediation_steps,
      evidence: `Manifest: ${input.manifest_file}\nPackage: ${input.package_name}\nInstalled: ${input.installed_version}\nFixed: ${input.fixed_version || "N/A"}${input.dependency_path ? `\nChain: ${input.dependency_path}` : ""}`,
      assumptions: "Application deploys the specified dependency version in production.",
      cve,
      cvss_score: advisoryCvss,
      severity,
      canonical_vector: `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N`,
      created_at: new Date().toISOString(),
      dependency_metadata: input,
      code_locations: [
        {
          file: input.manifest_file,
          start_line: 1,
          end_line: 1,
          snippet: `"${input.package_name}": "${input.installed_version}"`,
        },
      ],
      cvss_vector: {
        attack_vector: "N",
        attack_complexity: "L",
        privileges_required: "N",
        user_interaction: "N",
        scope: "U",
        confidentiality: "H",
        integrity: "H",
        availability: "N",
      },
    },
  }
}
