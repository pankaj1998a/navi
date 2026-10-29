/**
//! Navi Security Audit Engine & Cloudflare Workflow Orchestrator
//! Integrates 6-phase security auditing, coverage ledger tracking,
//! three-tier findings validation, and Rust-accelerated reporting.
*/

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { native } from "@/memory/native"

export type AuditVerdict = "confirmed" | "needs_validation" | "rejected"
export type AuditSeverity = "critical" | "high" | "medium" | "low" | "informational"

export interface SourceTraceLocation {
  file: string
  line?: number
  snippet?: string
  explanation?: string
}

export interface FindingRecord {
  id: string
  verdict: AuditVerdict
  title: string
  description: string
  surface?: string
  boundary?: string
  subsystem?: string
  attack_class?: string

  // Required for confirmed
  severity?: AuditSeverity
  trace?: SourceTraceLocation[]
  observed_result?: string
  remediation?: string

  // Required for needs_validation (severity is strictly prohibited)
  unresolved_fact?: string
  potential_impact?: string

  // Required for rejected
  rejection_reason?: string
}

export type UnitStatus =
  | "planned"
  | "not_applicable"
  | "out_of_scope"
  | "in_progress"
  | "covered"
  | "candidate"
  | "blocked"
  | "deferred"

export interface LedgerAttempt {
  wave?: number
  status?: string
  agent_id?: string
  reviewed_paths?: string[]
  local_checks?: string[]
  result_fingerprints?: string[]
  unresolved?: string[]
}

export interface CoverageUnit {
  coverage_id: string
  canonical_refs?: string[]
  surface?: string
  boundary?: string
  subsystem?: string
  attack_class?: string
  starting_paths?: string[]
  ordinary_attack_class_block?: string
  selected_companion_blocks?: string[]
  excluded_blocks?: string[]
  prior_status?: string
  attempts?: LedgerAttempt[]
  wave?: number
  status: UnitStatus
  agent_id?: string
  reviewed_paths?: string[]
  local_checks?: string[]
  result_fingerprints?: string[]
  unresolved?: string[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Rejects anything that is not a safe repository-relative path.
 *
 * Mirrors `is_safe_repo_relative_path` in packages/navi-native/src/security_audit.rs
 * so the TypeScript fallback enforces the same invariants as the native validator.
 */
export function isSafeRepoRelativePath(candidate: string): boolean {
  if (!candidate || candidate.length > 1024) return false
  if (candidate.startsWith("/") || candidate.startsWith("\\")) return false
  if (candidate.includes("\\") || candidate.includes("..")) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return false
  if (candidate.indexOf(":") === 1) return false
  return true
}

/**
 * Rejects strings with no visible (non-whitespace, non-control) characters.
 *
 * Mirrors `contains_visible_content` in packages/navi-native/src/security_audit.rs.
 */
export function containsVisibleContent(value: string): boolean {
  return /[^\s\u0000-\u001f\u007f]/.test(value)
}

const VALID_UNIT_STATUSES = new Set<UnitStatus>([
  "planned",
  "not_applicable",
  "out_of_scope",
  "in_progress",
  "covered",
  "candidate",
  "blocked",
  "deferred",
])

const VALID_SEVERITIES = new Set<AuditSeverity>(["critical", "high", "medium", "low", "informational"])

/**
 * Derives a canonical, collision-free coverage ID using SHA-256.
 */
export function computeCoverageId(
  surface: string,
  boundary: string,
  subsystem: string,
  attackClass: string,
  startingPaths: string[] = [],
): string {
  const sortedPaths = [...startingPaths].sort().join(",")
  const payload = `${surface}|${boundary}|${subsystem}|${attackClass}|${sortedPaths}`
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16)
}

/**
 * Validates a coverage ledger JSON string or object.
 * Prefers Rust native acceleration; falls back seamlessly to TypeScript.
 */
export function validateCoverageLedger(ledgerJsonOrObj: string | CoverageUnit[]): ValidationResult {
  const jsonStr = typeof ledgerJsonOrObj === "string" ? ledgerJsonOrObj : JSON.stringify(ledgerJsonOrObj, null, 2)

  if (native.isAvailable && native.validateLedger) {
    return native.validateLedger(jsonStr)
  }

  // Pure TypeScript Fallback
  try {
    const units: CoverageUnit[] = JSON.parse(jsonStr)
    if (!Array.isArray(units)) {
      return { valid: false, errors: ["Coverage ledger must be an array of units"] }
    }
    const errors: string[] = []
    const seenIds = new Set<string>()

    for (let i = 0; i < units.length; i++) {
      const u = units[i]!
      const prefix = `units[${i}]`

      if (!u.coverage_id || typeof u.coverage_id !== "string" || !containsVisibleContent(u.coverage_id)) {
        errors.push(`${prefix}.coverage_id: must be a non-empty string`)
      } else if (seenIds.has(u.coverage_id)) {
        errors.push(`${prefix}.coverage_id: duplicate id '${u.coverage_id}'`)
      } else {
        seenIds.add(u.coverage_id)
      }

      if (!u.status) {
        errors.push(`${prefix}.status: is required`)
      } else if (!VALID_UNIT_STATUSES.has(u.status)) {
        errors.push(`${prefix}.status: invalid status '${u.status}'`)
      }

      for (const [pIdx, p] of (u.starting_paths ?? []).entries()) {
        if (!isSafeRepoRelativePath(p)) {
          errors.push(`${prefix}.starting_paths[${pIdx}]: '${p}' is not a safe relative path`)
        }
      }

      for (const [pIdx, p] of (u.reviewed_paths ?? []).entries()) {
        if (!isSafeRepoRelativePath(p)) {
          errors.push(`${prefix}.reviewed_paths[${pIdx}]: '${p}' is not a safe relative path`)
        }
      }

      if (u.status === "candidate" && (!u.result_fingerprints || u.result_fingerprints.length === 0)) {
        errors.push(`${prefix}: candidate status requires non-empty result_fingerprints`)
      } else if (u.status === "blocked" && (!u.unresolved || u.unresolved.length === 0)) {
        errors.push(`${prefix}: blocked status requires non-empty unresolved explanations`)
      }
    }
    return { valid: errors.length === 0, errors }
  } catch (err: unknown) {
    return { valid: false, errors: [`JSON parse failure: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

/**
 * Validates a findings JSON string or array.
 * Prefers Rust native acceleration; falls back to TypeScript.
 */
export function validateFindings(findingsJsonOrObj: string | FindingRecord[]): ValidationResult {
  const jsonStr = typeof findingsJsonOrObj === "string" ? findingsJsonOrObj : JSON.stringify(findingsJsonOrObj, null, 2)

  if (native.isAvailable && native.validateFindings) {
    return native.validateFindings(jsonStr)
  }

  // Pure TypeScript Fallback
  try {
    const findings: FindingRecord[] = JSON.parse(jsonStr)
    if (!Array.isArray(findings)) {
      return { valid: false, errors: ["Findings must be a top-level array"] }
    }
    const errors: string[] = []
    const seenIds = new Set<string>()

    for (let i = 0; i < findings.length; i++) {
      const f = findings[i]!
      const prefix = `findings[${i}]`

      if (!f.id || !containsVisibleContent(f.id)) {
        errors.push(`${prefix}.id: must not be empty`)
      } else if (seenIds.has(f.id)) {
        errors.push(`${prefix}.id: duplicate id '${f.id}'`)
      } else {
        seenIds.add(f.id)
      }

      if (!f.title || !containsVisibleContent(f.title)) {
        errors.push(`${prefix}.title: must not be empty`)
      }

      if (!f.description || !containsVisibleContent(f.description)) {
        errors.push(`${prefix}.description: must contain visible characters`)
      }

      if (f.verdict === "confirmed") {
        if (!f.severity) {
          errors.push(`${prefix}.severity: required for confirmed findings`)
        } else if (!VALID_SEVERITIES.has(f.severity)) {
          errors.push(`${prefix}.severity: invalid severity '${f.severity}'`)
        }
        if (!f.trace || f.trace.length === 0) {
          errors.push(`${prefix}.trace: requires at least one source trace location`)
        } else {
          for (const [tIdx, loc] of f.trace.entries()) {
            if (!isSafeRepoRelativePath(loc.file)) {
              errors.push(`${prefix}.trace[${tIdx}].file: '${loc.file}' must be a safe repository-relative path`)
            }
          }
        }
        if (!f.observed_result || !containsVisibleContent(f.observed_result)) {
          errors.push(`${prefix}.observed_result: required for confirmed findings`)
        }
      } else if (f.verdict === "needs_validation") {
        if (f.severity) {
          errors.push(`${prefix}.severity: must NOT be set on needs_validation findings`)
        }
        if (!f.unresolved_fact || !containsVisibleContent(f.unresolved_fact)) {
          errors.push(`${prefix}.unresolved_fact: required for needs_validation leads`)
        }
        for (const [tIdx, loc] of (f.trace ?? []).entries()) {
          if (!isSafeRepoRelativePath(loc.file)) {
            errors.push(`${prefix}.trace[${tIdx}].file: '${loc.file}' must be a safe repository-relative path`)
          }
        }
      } else if (f.verdict === "rejected") {
        if (!f.rejection_reason || !containsVisibleContent(f.rejection_reason)) {
          errors.push(`${prefix}.rejection_reason: required for rejected candidates`)
        }
      } else {
        errors.push(`${prefix}.verdict: unknown verdict '${(f as unknown as Record<string, unknown>).verdict}'`)
      }
    }
    return { valid: errors.length === 0, errors }
  } catch (err: unknown) {
    return { valid: false, errors: [`JSON parse failure: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

/**
 * Generates audit markdown reports.
 */
export function generateAuditReport(
  findings: FindingRecord[] | string,
  ledger: CoverageUnit[] | string = [],
  reportType: "main" | "detail" | "needs_validation" = "main",
): string {
  const fJson = typeof findings === "string" ? findings : JSON.stringify(findings, null, 2)
  const lJson = typeof ledger === "string" ? ledger : JSON.stringify(ledger, null, 2)

  if (native.isAvailable && native.generateAuditReport) {
    const report = native.generateAuditReport(fJson, lJson, reportType)
    if (report && report.length > 0) return report
  }

  // Fallback TypeScript report generator
  const fList: FindingRecord[] = typeof findings === "string" ? JSON.parse(findings) : findings
  const confirmed = fList.filter((f) => f.verdict === "confirmed")
  const needsVal = fList.filter((f) => f.verdict === "needs_validation")
  const rejected = fList.filter((f) => f.verdict === "rejected")

  if (reportType === "detail") {
    let out = "# Confirmed Findings Detail\n\n"
    for (const f of confirmed) {
      out += `## ${f.title} [${(f.severity || "informational").toUpperCase()}]\n\n`
      out += `- **ID:** \`${f.id}\`\n- **Severity:** ${f.severity}\n\n${f.description}\n\n`
      if (f.trace) {
        out += "### Source Trace\n\n"
        for (const t of f.trace) {
          out += `- \`${t.file}\`${t.line ? ` (line ${t.line})` : ""}\n`
        }
        out += "\n"
      }
      if (f.remediation) {
        out += `### Remediation\n\n${f.remediation}\n\n`
      }
      out += "---\n\n"
    }
    return out
  }

  if (reportType === "needs_validation") {
    let out = "# Needs Validation Leads\n\n"
    for (const f of needsVal) {
      out += `## ${f.title}\n\n- **ID:** \`${f.id}\`\n- **Exact Blocker:** ${f.unresolved_fact || "Pending verification"}\n\n`
      out += `${f.description}\n\n---\n\n`
    }
    return out
  }

  let out = "# Security Audit Executive Report\n\n"
  out += "## Findings Overview\n\n"
  out += `| Metric | Count |\n| :--- | :--- |\n| **Confirmed Vulnerabilities** | **${confirmed.length}** |\n| **Needs Validation** | **${needsVal.length}** |\n| **Rejected** | **${rejected.length}** |\n\n`
  return out
}

/**
 * Initializes a new coverage ledger by scanning project directories.
 */
export function initCoverageLedger(
  targetDir: string,
  options: {
    surfaces?: string[]
    attackClasses?: string[]
  } = {},
): CoverageUnit[] {
  const units: CoverageUnit[] = []
  const surfaces = options.surfaces || ["cli", "api", "filesystem", "ipc", "memory"]
  const attackClasses = options.attackClasses || [
    "memory_safety",
    "prompt_injection",
    "path_traversal",
    "ssrf",
    "deserialization",
    "auth_bypass",
    "supply_chain",
    "resource_exhaustion",
  ]

  // Scan root directory entries to map starting paths
  const files: string[] = []
  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "target") continue
      files.push(entry.name)
    }
  } catch {
    // fallback
  }

  for (const surface of surfaces) {
    for (const attackClass of attackClasses) {
      const covId = computeCoverageId(surface, "default_boundary", "core", attackClass, files.slice(0, 3))
      units.push({
        coverage_id: covId,
        surface,
        boundary: "default_boundary",
        subsystem: "core",
        attack_class: attackClass,
        starting_paths: files.slice(0, 3),
        status: "planned",
        attempts: [],
        wave: 0,
        result_fingerprints: [],
        unresolved: [],
      })
    }
  }

  return units
}
