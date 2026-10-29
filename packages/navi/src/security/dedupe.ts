/**
 * Vulnerability Finding Deduplication Engine
 * Identifies duplicate findings by normalizing targets, code locations, root causes, and CVEs.
 */

import { type ValidatedVulnerabilityFinding } from "./poc-validator"

export interface DedupeResult {
  isDuplicate: boolean
  originalFindingId?: string
  reason?: string
}

export function computeFindingFingerprint(finding: ValidatedVulnerabilityFinding): string {
  // 1. If CVE is present, fingerprint by CVE + target
  if (finding.cve) {
    return `CVE:${finding.cve}:${normalizeTarget(finding.target)}`
  }

  // 2. If code location is present, fingerprint by file + line range + CWE
  if (finding.code_locations && finding.code_locations.length > 0) {
    const loc = finding.code_locations[0]
    if (loc) {
      return `CODE:${loc.file}:${loc.start_line}-${loc.end_line}:${finding.cwe || "VULN"}`
    }
  }

  // 3. Otherwise fingerprint by normalized target + CWE + canonical CVSS vector
  return `DYNAMIC:${normalizeTarget(finding.target)}:${finding.cwe || "VULN"}:${finding.canonical_vector}`
}

export function checkDuplicate(
  candidate: ValidatedVulnerabilityFinding,
  existingList: ValidatedVulnerabilityFinding[],
): DedupeResult {
  const candidateFingerprint = computeFindingFingerprint(candidate)

  for (const existing of existingList) {
    const existingFingerprint = computeFindingFingerprint(existing)

    // Direct fingerprint match
    if (candidateFingerprint === existingFingerprint) {
      return {
        isDuplicate: true,
        originalFindingId: existing.id,
        reason: `Matched exact fingerprint [${candidateFingerprint}] with existing finding ${existing.id}`,
      }
    }

    // Same CVE and same package/target
    if (candidate.cve && existing.cve && candidate.cve === existing.cve) {
      if (normalizeTarget(candidate.target) === normalizeTarget(existing.target)) {
        return {
          isDuplicate: true,
          originalFindingId: existing.id,
          reason: `Same CVE [${candidate.cve}] on same target asset`,
        }
      }
    }

    // Code location overlap
    if (
      candidate.code_locations &&
      existing.code_locations &&
      candidate.code_locations.length > 0 &&
      existing.code_locations.length > 0
    ) {
      const cLoc = candidate.code_locations[0]
      const eLoc = existing.code_locations[0]
      if (
        cLoc &&
        eLoc &&
        cLoc.file === eLoc.file &&
        candidate.cwe === existing.cwe &&
        Math.abs(cLoc.start_line - eLoc.start_line) <= 5
      ) {
        return {
          isDuplicate: true,
          originalFindingId: existing.id,
          reason: `Code location overlap in ${cLoc.file} around line ${cLoc.start_line} with matching CWE [${candidate.cwe}]`,
        }
      }
    }
  }

  return { isDuplicate: false }
}

function normalizeTarget(raw: string): string {
  try {
    const url = new URL(raw.startsWith("http") ? raw : `http://${raw}`)
    return `${url.hostname}${url.pathname.toLowerCase()}`
  } catch {
    return raw.trim().toLowerCase()
  }
}
