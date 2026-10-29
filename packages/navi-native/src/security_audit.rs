//! Native Rust Security Audit Accelerator for Navi
//! Implements high-performance, memory-safe, cross-platform validation
//! for Cloudflare security-audit-skill coverage-ledger.json and findings.json,
//! plus target-neutral markdown report generation.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_INPUT_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_UNITS: usize = 10_000;
pub const MAX_FINDINGS: usize = 1_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

impl ValidationResult {
    pub fn ok() -> Self {
        Self { valid: true, errors: Vec::new() }
    }

    pub fn failed(errors: Vec<String>) -> Self {
        Self { valid: false, errors }
    }
}

// ============================================================================
// Coverage Ledger Data Model & Validator
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerAttempt {
    #[serde(default)]
    pub wave: Option<u32>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub reviewed_paths: Option<Vec<String>>,
    #[serde(default)]
    pub local_checks: Option<Vec<String>>,
    #[serde(default)]
    pub result_fingerprints: Option<Vec<String>>,
    #[serde(default)]
    pub unresolved: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverageUnit {
    #[serde(default)]
    pub coverage_id: Option<String>,
    #[serde(default)]
    pub canonical_refs: Option<Vec<String>>,
    #[serde(default)]
    pub surface: Option<String>,
    #[serde(default)]
    pub boundary: Option<String>,
    #[serde(default)]
    pub subsystem: Option<String>,
    #[serde(default)]
    pub attack_class: Option<String>,
    #[serde(default)]
    pub starting_paths: Option<Vec<String>>,
    #[serde(default)]
    pub ordinary_attack_class_block: Option<String>,
    #[serde(default)]
    pub selected_companion_blocks: Option<Vec<String>>,
    #[serde(default)]
    pub excluded_blocks: Option<Vec<String>>,
    #[serde(default)]
    pub prior_status: Option<String>,
    #[serde(default)]
    pub attempts: Option<Vec<LedgerAttempt>>,
    #[serde(default)]
    pub wave: Option<u32>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub reviewed_paths: Option<Vec<String>>,
    #[serde(default)]
    pub local_checks: Option<Vec<String>>,
    #[serde(default)]
    pub result_fingerprints: Option<Vec<String>>,
    #[serde(default)]
    pub unresolved: Option<Vec<String>>,
}

fn is_safe_repo_relative_path(path_str: &str) -> bool {
    if path_str.is_empty() || path_str.len() > 1024 {
        return false;
    }
    // Reject absolute paths, Windows drive letters, backslashes, parent traversal
    if path_str.starts_with('/') || path_str.starts_with('\\') {
        return false;
    }
    if path_str.contains('\\') || path_str.contains("..") {
        return false;
    }
    if path_str.chars().any(|c| c.is_control() || c == '\0') {
        return false;
    }
    if let Some(first_colon) = path_str.find(':') {
        if first_colon == 1 {
            return false; // Windows drive e.g. C:
        }
    }
    true
}

fn contains_visible_content(s: &str) -> bool {
    s.chars().any(|c| !c.is_whitespace() && !c.is_control())
}

pub fn validate_coverage_ledger(json_str: &str) -> ValidationResult {
    if json_str.len() > MAX_INPUT_BYTES {
        return ValidationResult::failed(vec![format!("Input exceeds {} bytes limit", MAX_INPUT_BYTES)]);
    }

    let units: Vec<CoverageUnit> = match serde_json::from_str(json_str) {
        Ok(u) => u,
        Err(e) => return ValidationResult::failed(vec![format!("JSON parse error: {}", e)]),
    };

    if units.len() > MAX_UNITS {
        return ValidationResult::failed(vec![format!("Units count {} exceeds limit {}", units.len(), MAX_UNITS)]);
    }

    let mut errors = Vec::new();
    let mut seen_ids = HashSet::new();

    let valid_statuses: HashSet<&'static str> = [
        "planned", "not_applicable", "out_of_scope", "in_progress",
        "covered", "candidate", "blocked", "deferred"
    ].into_iter().collect();

    for (idx, unit) in units.iter().enumerate() {
        let prefix = format!("units[{}]", idx);

        let cov_id = match &unit.coverage_id {
            Some(id) if contains_visible_content(id) => id.clone(),
            _ => {
                errors.push(format!("{}.coverage_id: must be a non-empty string", prefix));
                String::new()
            }
        };

        if !cov_id.is_empty() {
            if !seen_ids.insert(cov_id.clone()) {
                errors.push(format!("{}.coverage_id: duplicate id '{}'", prefix, cov_id));
            }
        }

        if let Some(status) = &unit.status {
            if !valid_statuses.contains(status.as_str()) {
                errors.push(format!("{}.status: invalid status '{}'", prefix, status));
            }
        } else {
            errors.push(format!("{}.status: field is required", prefix));
        }

        if let Some(paths) = &unit.starting_paths {
            for (p_idx, p) in paths.iter().enumerate() {
                if !is_safe_repo_relative_path(p) {
                    errors.push(format!("{}.starting_paths[{}]: '{}' is not a safe relative path", prefix, p_idx, p));
                }
            }
        }

        if let Some(reviewed) = &unit.reviewed_paths {
            for (r_idx, r) in reviewed.iter().enumerate() {
                if !is_safe_repo_relative_path(r) {
                    errors.push(format!("{}.reviewed_paths[{}]: '{}' is not a safe relative path", prefix, r_idx, r));
                }
            }
        }

        // State invariants
        if let Some(status) = &unit.status {
            match status.as_str() {
                "candidate" => {
                    let has_fps = unit.result_fingerprints.as_ref().map(|f| !f.is_empty()).unwrap_or(false);
                    if !has_fps {
                        errors.push(format!("{}: candidate status requires non-empty result_fingerprints", prefix));
                    }
                }
                "blocked" => {
                    let has_unresolved = unit.unresolved.as_ref().map(|u| !u.is_empty()).unwrap_or(false);
                    if !has_unresolved {
                        errors.push(format!("{}: blocked status requires non-empty unresolved reasons", prefix));
                    }
                }
                _ => {}
            }
        }

        if errors.len() >= 100 {
            errors.push("...error output capped at 100".to_string());
            break;
        }
    }

    if errors.is_empty() {
        ValidationResult::ok()
    } else {
        ValidationResult::failed(errors)
    }
}

// ============================================================================
// Findings Data Model & Validator
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceTraceLocation {
    pub file: String,
    #[serde(default)]
    pub line: Option<u32>,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub explanation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindingRecord {
    pub id: String,
    pub verdict: String,
    pub title: String,
    pub description: String,

    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub surface: Option<String>,
    #[serde(default)]
    pub boundary: Option<String>,
    #[serde(default)]
    pub subsystem: Option<String>,
    #[serde(default)]
    pub attack_class: Option<String>,

    #[serde(default)]
    pub trace: Option<Vec<SourceTraceLocation>>,
    #[serde(default)]
    pub observed_result: Option<String>,
    #[serde(default)]
    pub remediation: Option<String>,

    // For needs_validation
    #[serde(default)]
    pub unresolved_fact: Option<String>,
    #[serde(default)]
    pub potential_impact: Option<String>,

    // For rejected
    #[serde(default)]
    pub rejection_reason: Option<String>,
}

pub fn validate_findings(json_str: &str) -> ValidationResult {
    if json_str.len() > MAX_INPUT_BYTES {
        return ValidationResult::failed(vec![format!("Input exceeds {} bytes limit", MAX_INPUT_BYTES)]);
    }

    let findings: Vec<FindingRecord> = match serde_json::from_str(json_str) {
        Ok(f) => f,
        Err(e) => return ValidationResult::failed(vec![format!("JSON parse error: {}", e)]),
    };

    if findings.len() > MAX_FINDINGS {
        return ValidationResult::failed(vec![format!("Findings count {} exceeds limit {}", findings.len(), MAX_FINDINGS)]);
    }

    let mut errors = Vec::new();
    let mut seen_ids = HashSet::new();

    let valid_severities: HashSet<&'static str> = [
        "critical", "high", "medium", "low", "informational"
    ].into_iter().collect();

    for (idx, f) in findings.iter().enumerate() {
        let prefix = format!("findings[{}]", idx);

        if !contains_visible_content(&f.id) {
            errors.push(format!("{}.id: must contain visible characters", prefix));
        } else if !seen_ids.insert(f.id.clone()) {
            errors.push(format!("{}.id: duplicate finding id '{}'", prefix, f.id));
        }

        if !contains_visible_content(&f.title) {
            errors.push(format!("{}.title: must contain visible characters", prefix));
        }

        if !contains_visible_content(&f.description) {
            errors.push(format!("{}.description: must contain visible characters", prefix));
        }

        match f.verdict.as_str() {
            "confirmed" => {
                // Must have severity
                match &f.severity {
                    Some(s) if valid_severities.contains(s.as_str()) => {}
                    Some(s) => errors.push(format!("{}.severity: invalid severity '{}'", prefix, s)),
                    None => errors.push(format!("{}.severity: required for confirmed findings", prefix)),
                }

                // Must have non-empty trace
                match &f.trace {
                    Some(t) if !t.is_empty() => {
                        for (t_idx, loc) in t.iter().enumerate() {
                            if !is_safe_repo_relative_path(&loc.file) {
                                errors.push(format!("{}.trace[{}].file: '{}' must be a safe repository-relative path", prefix, t_idx, loc.file));
                            }
                        }
                    }
                    _ => errors.push(format!("{}.trace: must contain at least one source trace location", prefix)),
                }

                // Must have observed_result
                if let Some(obs) = &f.observed_result {
                    if !contains_visible_content(obs) {
                        errors.push(format!("{}.observed_result: must not be empty", prefix));
                    }
                } else {
                    errors.push(format!("{}.observed_result: required for confirmed findings", prefix));
                }
            }
            "needs_validation" => {
                // Critical Cloudflare Rule: needs_validation MUST NOT have a severity
                if f.severity.is_some() {
                    errors.push(format!("{}.severity: must NOT be set on needs_validation findings (unresolved leads carry no severity)", prefix));
                }

                // Must have unresolved_fact
                if let Some(fact) = &f.unresolved_fact {
                    if !contains_visible_content(fact) {
                        errors.push(format!("{}.unresolved_fact: must not be empty", prefix));
                    }
                } else {
                    errors.push(format!("{}.unresolved_fact: required for needs_validation", prefix));
                }

                // Must have trace
                if let Some(t) = &f.trace {
                    for (t_idx, loc) in t.iter().enumerate() {
                        if !is_safe_repo_relative_path(&loc.file) {
                            errors.push(format!("{}.trace[{}].file: '{}' must be a safe repository-relative path", prefix, t_idx, loc.file));
                        }
                    }
                }
            }
            "rejected" => {
                if let Some(reason) = &f.rejection_reason {
                    if !contains_visible_content(reason) {
                        errors.push(format!("{}.rejection_reason: must not be empty", prefix));
                    }
                } else {
                    errors.push(format!("{}.rejection_reason: required for rejected findings", prefix));
                }
            }
            other => {
                errors.push(format!("{}.verdict: unknown verdict '{}' (must be confirmed, needs_validation, or rejected)", prefix, other));
            }
        }

        if errors.len() >= 100 {
            errors.push("...error output capped at 100".to_string());
            break;
        }
    }

    if errors.is_empty() {
        ValidationResult::ok()
    } else {
        ValidationResult::failed(errors)
    }
}

// ============================================================================
// Markdown Report Generator
// ============================================================================

pub fn generate_markdown_report(
    findings_json: &str,
    ledger_json: &str,
    report_type: &str, // "main", "detail", or "needs_validation"
) -> Result<String, String> {
    let findings: Vec<FindingRecord> = serde_json::from_str(findings_json)
        .map_err(|e| format!("Failed to parse findings JSON: {}", e))?;
    let units: Vec<CoverageUnit> = if !ledger_json.trim().is_empty() {
        serde_json::from_str(ledger_json).unwrap_or_default()
    } else {
        Vec::new()
    };

    match report_type {
        "detail" => Ok(generate_findings_detail(&findings)),
        "needs_validation" => Ok(generate_needs_validation(&findings)),
        _ => Ok(generate_main_report(&findings, &units)),
    }
}

fn generate_main_report(findings: &[FindingRecord], units: &[CoverageUnit]) -> String {
    let mut out = String::new();
    out.push_str("# Security Audit Executive Report\n\n");
    out.push_str("Generated by Navi Security Audit Engine (accelerated with Rust).\n\n");

    // Findings count
    let confirmed: Vec<_> = findings.iter().filter(|f| f.verdict == "confirmed").collect();
    let needs_val: Vec<_> = findings.iter().filter(|f| f.verdict == "needs_validation").collect();
    let rejected: Vec<_> = findings.iter().filter(|f| f.verdict == "rejected").collect();

    let mut crit = 0;
    let mut high = 0;
    let mut med = 0;
    let mut low = 0;
    let mut info = 0;

    for f in &confirmed {
        match f.severity.as_deref() {
            Some("critical") => crit += 1,
            Some("high") => high += 1,
            Some("medium") => med += 1,
            Some("low") => low += 1,
            _ => info += 1,
        }
    }

    out.push_str("## 1. Findings Overview\n\n");
    out.push_str("| Metric | Count |\n");
    out.push_str("| :--- | :--- |\n");
    out.push_str(&format!("| **Confirmed Vulnerabilities** | **{}** |\n", confirmed.len()));
    out.push_str(&format!("| - Critical | {} |\n", crit));
    out.push_str(&format!("| - High | {} |\n", high));
    out.push_str(&format!("| - Medium | {} |\n", med));
    out.push_str(&format!("| - Low | {} |\n", low));
    out.push_str(&format!("| - Informational | {} |\n", info));
    out.push_str(&format!("| **Needs Validation (Blocked Leads)** | **{}** |\n", needs_val.len()));
    out.push_str(&format!("| **Rejected Candidates (Disproven)** | **{}** |\n\n", rejected.len()));

    // Coverage Overview
    if !units.is_empty() {
        let total = units.len();
        let covered = units.iter().filter(|u| u.status.as_deref() == Some("covered")).count();
        let candidate = units.iter().filter(|u| u.status.as_deref() == Some("candidate")).count();
        let blocked = units.iter().filter(|u| u.status.as_deref() == Some("blocked")).count();
        let planned = units.iter().filter(|u| u.status.as_deref() == Some("planned")).count();

        out.push_str("## 2. Coverage Ledger Progress\n\n");
        out.push_str("| Status | Units | Percentage |\n");
        out.push_str("| :--- | :--- | :--- |\n");
        out.push_str(&format!("| Covered | {} | {:.1}% |\n", covered, (covered as f64 / total as f64) * 100.0));
        out.push_str(&format!("| Candidate | {} | {:.1}% |\n", candidate, (candidate as f64 / total as f64) * 100.0));
        out.push_str(&format!("| Blocked | {} | {:.1}% |\n", blocked, (blocked as f64 / total as f64) * 100.0));
        out.push_str(&format!("| Planned / Remaining | {} | {:.1}% |\n", planned, (planned as f64 / total as f64) * 100.0));
        out.push_str(&format!("| **Total Units** | **{}** | **100.0%** |\n\n", total));
    }

    // Confirmed Table
    out.push_str("## 3. Confirmed Vulnerabilities Table\n\n");
    if confirmed.is_empty() {
        out.push_str("*No confirmed vulnerabilities found.*\n\n");
    } else {
        out.push_str("| ID | Severity | Title | Surface / Subsystem |\n");
        out.push_str("| :--- | :--- | :--- | :--- |\n");
        for f in &confirmed {
            let sev = f.severity.as_deref().unwrap_or("informational").to_uppercase();
            let sub = f.subsystem.as_deref().unwrap_or("-");
            out.push_str(&format!("| `{}` | **{}** | {} | {} |\n", f.id, sev, f.title, sub));
        }
        out.push_str("\n");
    }

    out
}

fn generate_findings_detail(findings: &[FindingRecord]) -> String {
    let mut out = String::new();
    out.push_str("# Confirmed Findings Detail\n\n");

    let confirmed: Vec<_> = findings.iter().filter(|f| f.verdict == "confirmed").collect();
    if confirmed.is_empty() {
        out.push_str("*No confirmed vulnerabilities reported.*\n");
        return out;
    }

    for (i, f) in confirmed.iter().enumerate() {
        let sev = f.severity.as_deref().unwrap_or("informational").to_uppercase();
        out.push_str(&format!("## {}. {} [{}]\n\n", i + 1, f.title, sev));
        out.push_str(&format!("- **ID:** `{}`\n", f.id));
        out.push_str(&format!("- **Severity:** {}\n", sev));
        if let Some(surf) = &f.surface {
            out.push_str(&format!("- **Attack Surface:** {}\n", surf));
        }
        if let Some(bnd) = &f.boundary {
            out.push_str(&format!("- **Trust Boundary:** {}\n", bnd));
        }
        if let Some(atk) = &f.attack_class {
            out.push_str(&format!("- **Attack Class:** {}\n", atk));
        }
        out.push_str("\n### Description\n\n");
        out.push_str(&f.description);
        out.push_str("\n\n");

        if let Some(trace) = &f.trace {
            out.push_str("### Source Trace\n\n");
            for (t_idx, loc) in trace.iter().enumerate() {
                out.push_str(&format!("{}. `{}`", t_idx + 1, loc.file));
                if let Some(line) = loc.line {
                    out.push_str(&format!(" (line {})", line));
                }
                out.push_str("\n");
                if let Some(exp) = &loc.explanation {
                    out.push_str(&format!("   - *Context:* {}\n", exp));
                }
                if let Some(snip) = &loc.snippet {
                    out.push_str(&format!("   ```\n   {}\n   ```\n", snip));
                }
            }
            out.push_str("\n");
        }

        if let Some(obs) = &f.observed_result {
            out.push_str("### Observed Result\n\n");
            out.push_str(obs);
            out.push_str("\n\n");
        }

        if let Some(rem) = &f.remediation {
            out.push_str("### Remediation Guidance\n\n");
            out.push_str(rem);
            out.push_str("\n\n");
        }

        out.push_str("---\n\n");
    }

    out
}

fn generate_needs_validation(findings: &[FindingRecord]) -> String {
    let mut out = String::new();
    out.push_str("# Needs Validation (Blocked Candidate Leads)\n\n");
    out.push_str("These findings represent source-grounded vulnerability hypotheses that require external environment verification, running services, or runtime fuzzing before they can be confirmed.\n\n");

    let leads: Vec<_> = findings.iter().filter(|f| f.verdict == "needs_validation").collect();
    if leads.is_empty() {
        out.push_str("*No leads currently require external validation.*\n");
        return out;
    }

    for (i, f) in leads.iter().enumerate() {
        out.push_str(&format!("## {}. {}\n\n", i + 1, f.title));
        out.push_str(&format!("- **ID:** `{}`\n", f.id));
        if let Some(fact) = &f.unresolved_fact {
            out.push_str(&format!("- **Exact Unresolved Fact:** {}\n", fact));
        }
        if let Some(impact) = &f.potential_impact {
            out.push_str(&format!("- **Potential Impact:** {}\n", impact));
        }
        out.push_str("\n### Description\n\n");
        out.push_str(&f.description);
        out.push_str("\n\n");

        if let Some(trace) = &f.trace {
            out.push_str("### Relevant Source Locations\n\n");
            for loc in trace {
                out.push_str(&format!("- `{}`", loc.file));
                if let Some(line) = loc.line {
                    out.push_str(&format!(" (line {})", line));
                }
                out.push_str("\n");
            }
            out.push_str("\n");
        }

        out.push_str("---\n\n");
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coverage_ledger_validation() {
        let valid_json = r#"[
            {
                "coverage_id": "cov-01",
                "status": "covered",
                "starting_paths": ["src/api/auth.rs"],
                "attempts": []
            }
        ]"#;
        let res = validate_coverage_ledger(valid_json);
        assert!(res.valid, "Expected valid, got: {:?}", res.errors);

        let invalid_json = r#"[
            {
                "coverage_id": "cov-01",
                "status": "candidate",
                "result_fingerprints": []
            }
        ]"#;
        let res2 = validate_coverage_ledger(invalid_json);
        assert!(!res2.valid, "Candidate without result_fingerprints should fail");
    }

    #[test]
    fn test_findings_validation() {
        let valid_confirmed = r#"[
            {
                "id": "FIND-01",
                "verdict": "confirmed",
                "title": "SQL Injection in User Search",
                "description": "Unescaped user input concatenated into query string",
                "severity": "high",
                "trace": [
                    { "file": "src/db/users.ts", "line": 42 }
                ],
                "observed_result": "Database syntax error returned upon sending single quote"
            }
        ]"#;
        let res = validate_findings(valid_confirmed);
        assert!(res.valid, "Confirmed finding should be valid: {:?}", res.errors);

        // needs_validation with severity MUST FAIL
        let invalid_lead = r#"[
            {
                "id": "FIND-02",
                "verdict": "needs_validation",
                "title": "Suspected SSRF",
                "description": "Fetch called with webhook URL",
                "severity": "medium",
                "unresolved_fact": "Need running DNS server to verify private IP resolution"
            }
        ]"#;
        let res2 = validate_findings(invalid_lead);
        assert!(!res2.valid, "needs_validation with severity must fail validation");
    }
}
