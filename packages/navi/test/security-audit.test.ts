import { describe, it, expect } from "bun:test"
import {
  computeCoverageId,
  validateCoverageLedger,
  validateFindings,
  generateAuditReport,
  initCoverageLedger,
  type CoverageUnit,
  type FindingRecord,
} from "../src/security/audit"

describe("Security Audit Module", () => {
  it("derives deterministic canonical coverage IDs", () => {
    const id1 = computeCoverageId("cli", "subcommand", "core", "memory_safety", ["src/main.rs"])
    const id2 = computeCoverageId("cli", "subcommand", "core", "memory_safety", ["src/main.rs"])
    expect(id1).toBe(id2)
    expect(id1.length).toBe(16)
  })

  it("validates a well-formed coverage ledger", () => {
    const units: CoverageUnit[] = [
      {
        coverage_id: "cov-101",
        status: "covered",
        surface: "cli",
        starting_paths: ["src/cli.ts"],
        attempts: [],
      },
    ]
    const result = validateCoverageLedger(units)
    expect(result.valid).toBe(true)
    expect(result.errors.length).toBe(0)
  })

  it("rejects candidate status without result_fingerprints", () => {
    const units: CoverageUnit[] = [
      {
        coverage_id: "cov-102",
        status: "candidate",
        result_fingerprints: [],
      },
    ]
    const result = validateCoverageLedger(units)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("result_fingerprints"))).toBe(true)
  })

  it("validates confirmed findings with required traces and severity", () => {
    const findings: FindingRecord[] = [
      {
        id: "VULN-001",
        verdict: "confirmed",
        title: "Arbitrary File Read",
        description: "Path traversal via unvalidated user parameter",
        severity: "high",
        surface: "filesystem",
        trace: [{ file: "src/io.ts", line: 42 }],
        observed_result: "File /etc/passwd contents returned in HTTP response",
        remediation: "Use path.resolve and verify target stays within root directory.",
      },
    ]
    const result = validateFindings(findings)
    expect(result.valid).toBe(true)
    expect(result.errors.length).toBe(0)
  })

  it("strictly rejects needs_validation findings that include a severity", () => {
    const findings: FindingRecord[] = [
      {
        id: "LEAD-001",
        verdict: "needs_validation",
        title: "Suspected Insecure Direct Object Reference",
        description: "User ID read directly from header without tenant verification",
        severity: "medium", // PROHIBITED by Cloudflare Security Audit spec
        unresolved_fact: "Requires production test database with multiple tenant accounts",
      },
    ]
    const result = validateFindings(findings)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("needs_validation"))).toBe(true)
  })

  it("generates markdown reports across all report tiers", () => {
    const findings: FindingRecord[] = [
      {
        id: "VULN-001",
        verdict: "confirmed",
        title: "Arbitrary File Read",
        description: "Path traversal via unvalidated user parameter",
        severity: "high",
        surface: "filesystem",
        trace: [{ file: "src/io.ts", line: 42 }],
        observed_result: "Disclosed file",
      },
      {
        id: "LEAD-001",
        verdict: "needs_validation",
        title: "Suspected IDOR",
        description: "Potential tenant crossover",
        unresolved_fact: "Need multi-tenant cluster to verify",
      },
      {
        id: "REJ-001",
        verdict: "rejected",
        title: "Theoretical Timing Attack",
        description: "Hash comparison timing variance",
        rejection_reason: "crypto.timingSafeEqual is already used in crypto.ts",
      },
    ]

    const mainReport = generateAuditReport(findings, [], "main")
    expect(mainReport).toContain("Security Audit Executive Report")
    expect(mainReport).toContain("Confirmed Vulnerabilities")

    const detailReport = generateAuditReport(findings, [], "detail")
    expect(detailReport).toContain("Arbitrary File Read")
    expect(detailReport).toContain("src/io.ts")

    const leadsReport = generateAuditReport(findings, [], "needs_validation")
    expect(leadsReport).toContain("Suspected IDOR")
    expect(leadsReport).toContain("Need multi-tenant cluster to verify")
  })

  it("initializes coverage units for a target directory", () => {
    const units = initCoverageLedger(process.cwd(), {
      surfaces: ["cli", "api"],
      attackClasses: ["memory_safety", "prompt_injection"],
    })
    expect(units.length).toBe(4) // 2 surfaces * 2 attack classes
    expect(units[0]?.status).toBe("planned")
    expect(units[0]?.coverage_id.length).toBe(16)
  })
})
