import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import path from "node:path"
import fs from "node:fs"
import {
  initCoverageLedger,
  validateCoverageLedger,
  validateFindings,
  generateAuditReport,
  type CoverageUnit,
  type FindingRecord,
} from "@/security/audit"

export const AuditCommand = effectCmd({
  command: "audit [action]",
  describe: "Run Cloudflare-style structured security audit (6-phase coverage, validation, and reporting)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Audit action: 'init' (initialize ledger), 'validate' (validate files), 'report' (generate markdown reports), 'status' (summary)",
        choices: ["init", "validate", "report", "status"] as const,
        default: "status",
      })
      .option("dir", {
        alias: "d",
        describe: "Directory containing audit files (defaults to current working directory or ./audit)",
        type: "string",
      })
      .option("out", {
        alias: "o",
        describe: "Directory to write output reports",
        type: "string",
      }),
  handler: Effect.fn("Cli.audit")(function* (args) {
    const baseDir = process.cwd()
    const auditDir = args.dir ? (path.isAbsolute(args.dir) ? args.dir : path.resolve(baseDir, args.dir)) : baseDir
    const outDir = args.out ? (path.isAbsolute(args.out) ? args.out : path.resolve(baseDir, args.out)) : auditDir

    const ledgerPath = path.join(auditDir, "coverage-ledger.json")
    const findingsPath = path.join(auditDir, "findings.json")

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  🛡️ Navi Security Audit Engine (Cloudflare 6-Phase Standard)")
    UI.println(UI.Style.TEXT_DIM + `  Working directory: ${auditDir}`)
    UI.empty()

    const action = args.action || "status"

    if (action === "init") {
      if (!fs.existsSync(auditDir)) {
        fs.mkdirSync(auditDir, { recursive: true })
      }
      UI.println(UI.Style.TEXT_NORMAL + "  [Phase 1] Mapping architecture and initializing coverage ledger...")
      const units = initCoverageLedger(baseDir)
      fs.writeFileSync(ledgerPath, JSON.stringify(units, null, 2), "utf8")
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  ✓ Created coverage ledger with ${units.length} canonical units at:`)
      UI.println(UI.Style.TEXT_DIM + `    ${ledgerPath}`)

      const archPath = path.join(auditDir, "architecture.md")
      if (!fs.existsSync(archPath)) {
        const archContent = `# System Architecture & Trust Boundaries\n\n- Root: \`${baseDir}\`\n- Initial Units: ${units.length}\n- Audit Standard: Cloudflare Security Audit Harness\n`
        fs.writeFileSync(archPath, archContent, "utf8")
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  ✓ Created architecture map template:`)
        UI.println(UI.Style.TEXT_DIM + `    ${archPath}`)
      }
      return
    }

    if (action === "validate") {
      UI.println(UI.Style.TEXT_NORMAL + "  [Validation] Running native Rust validation on audit artifacts...")

      let hasErrors = false

      if (fs.existsSync(ledgerPath)) {
        const ledgerRaw = fs.readFileSync(ledgerPath, "utf8")
        const res = validateCoverageLedger(ledgerRaw)
        if (res.valid) {
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  ✓ coverage-ledger.json: VALID (all invariants preserved)`)
        } else {
          hasErrors = true
          UI.println(UI.Style.TEXT_DANGER_BOLD + `  ❌ coverage-ledger.json: FAILED validation (${res.errors.length} errors)`)
          for (const err of res.errors.slice(0, 10)) {
            UI.println(UI.Style.TEXT_DANGER + `     • ${err}`)
          }
        }
      } else {
        UI.println(UI.Style.TEXT_WARNING + `  ⚠ coverage-ledger.json not found in ${auditDir}`)
      }

      if (fs.existsSync(findingsPath)) {
        const findingsRaw = fs.readFileSync(findingsPath, "utf8")
        const res = validateFindings(findingsRaw)
        if (res.valid) {
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `  ✓ findings.json: VALID (strictly conforms to report-schema)`)
        } else {
          hasErrors = true
          UI.println(UI.Style.TEXT_DANGER_BOLD + `  ❌ findings.json: FAILED validation (${res.errors.length} errors)`)
          for (const err of res.errors.slice(0, 10)) {
            UI.println(UI.Style.TEXT_DANGER + `     • ${err}`)
          }
        }
      } else {
        UI.println(UI.Style.TEXT_WARNING + `  ⚠ findings.json not found in ${auditDir}`)
      }

      if (!hasErrors) {
        UI.println(UI.Style.TEXT_SUCCESS + "\n  Audit records passed all integrity and safety checks.")
      }
      return
    }

    if (action === "report") {
      UI.println(UI.Style.TEXT_NORMAL + "  [Phase 6] Generating target-neutral executive and technical reports...")
      if (!fs.existsSync(findingsPath)) {
        UI.println(UI.Style.TEXT_DANGER_BOLD + `  ❌ Cannot generate reports: findings.json missing at ${findingsPath}`)
        return
      }

      const findingsRaw = fs.readFileSync(findingsPath, "utf8")
      const ledgerRaw = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, "utf8") : "[]"

      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true })
      }

      const reportMain = generateAuditReport(findingsRaw, ledgerRaw, "main")
      const reportDetail = generateAuditReport(findingsRaw, ledgerRaw, "detail")
      const reportLeads = generateAuditReport(findingsRaw, ledgerRaw, "needs_validation")

      const reportMainPath = path.join(outDir, "REPORT.md")
      const reportDetailPath = path.join(outDir, "FINDINGS-DETAIL.md")
      const reportLeadsPath = path.join(outDir, "NEEDS-VALIDATION.md")

      fs.writeFileSync(reportMainPath, reportMain, "utf8")
      fs.writeFileSync(reportDetailPath, reportDetail, "utf8")
      fs.writeFileSync(reportLeadsPath, reportLeads, "utf8")

      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "  ✓ Generated Reports:")
      UI.println(UI.Style.TEXT_DIM + `    • Executive Report:      ${reportMainPath}`)
      UI.println(UI.Style.TEXT_DIM + `    • Detailed Findings:     ${reportDetailPath}`)
      UI.println(UI.Style.TEXT_DIM + `    • Unresolved Leads:      ${reportLeadsPath}`)
      return
    }

    // Default: status
    UI.println(UI.Style.TEXT_NORMAL + "  [Status] Current Audit Workspace Status:\n")

    if (fs.existsSync(ledgerPath)) {
      try {
        const units: CoverageUnit[] = JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
        const total = units.length
        const covered = units.filter((u) => u.status === "covered").length
        const candidate = units.filter((u) => u.status === "candidate").length
        const blocked = units.filter((u) => u.status === "blocked").length
        const planned = units.filter((u) => u.status === "planned").length

        UI.println(UI.Style.TEXT_INFO_BOLD + `  Coverage Progress:`)
        UI.println(`    • Total Units: ${total}`)
        UI.println(`    • Covered:     ${covered} (${((covered / (total || 1)) * 100).toFixed(1)}%)`)
        UI.println(`    • Candidate:   ${candidate}`)
        UI.println(`    • Blocked:     ${blocked}`)
        UI.println(`    • Planned:     ${planned}`)
      } catch {
        UI.println(UI.Style.TEXT_DANGER + `    • coverage-ledger.json is invalid JSON`)
      }
    } else {
      UI.println(UI.Style.TEXT_DIM + `  • No coverage ledger found. Initialize with: navi audit init`)
    }

    if (fs.existsSync(findingsPath)) {
      try {
        const findings: FindingRecord[] = JSON.parse(fs.readFileSync(findingsPath, "utf8"))
        const confirmed = findings.filter((f) => f.verdict === "confirmed")
        const needsVal = findings.filter((f) => f.verdict === "needs_validation")
        const rejected = findings.filter((f) => f.verdict === "rejected")

        UI.println(UI.Style.TEXT_INFO_BOLD + `\n  Findings Overview:`)
        UI.println(`    • Confirmed:        ${confirmed.length}`)
        UI.println(`    • Needs Validation: ${needsVal.length}`)
        UI.println(`    • Rejected:         ${rejected.length}`)
      } catch {
        UI.println(UI.Style.TEXT_DANGER + `    • findings.json is invalid JSON`)
      }
    } else {
      UI.println(UI.Style.TEXT_DIM + `  • No findings recorded yet.`)
    }

    UI.println(UI.Style.TEXT_DIM + `\n  Usage:`)
    UI.println(UI.Style.TEXT_DIM + `    navi audit init       Initialize coverage ledger and architecture template`)
    UI.println(UI.Style.TEXT_DIM + `    navi audit validate   Verify coverage ledger and findings schema validity`)
    UI.println(UI.Style.TEXT_DIM + `    navi audit report     Generate target-neutral markdown reports`)
  }),
})
