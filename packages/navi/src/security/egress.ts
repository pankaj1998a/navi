/**
 * Egress & Adversary Inspector
 * Inspired by Goose (crates/goose/src/security/egress_inspector.rs & adversary_inspector.rs).
 * Intercepts shell commands and tool calls prior to execution to prevent:
 *  1. Data exfiltration (piping secrets, post-file payloads, reverse shells)
 *  2. Prompt injection & obfuscated payload execution (curl|sh, base64|iex)
 *  3. Egress to untrusted / unverified external endpoints
 */

import path from "node:path"
import fs from "node:fs"
import { validateTargetUrl } from "./url-safety"

export interface EgressDestination {
  kind: "url" | "ip" | "reverse_shell" | "pipe_remote"
  target: string
  domain?: string
}

export interface SecurityInspectionResult {
  allowed: boolean
  category?: "egress_exfiltration" | "adversary_injection" | "destructive_remote" | "obfuscation"
  reason?: string
  destinations?: EgressDestination[]
  remediation?: string
}

// Common safe developer domains
const TRUSTED_DOMAINS = new Set([
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
  "npmjs.org",
  "registry.npmjs.org",
  "bun.sh",
  "crates.io",
  "pypi.org",
  "deno.land",
  "golang.org",
  "huggingface.co",
  "anthropic.com",
  "api.anthropic.com",
  "openai.com",
  "api.openai.com",
  "deepseek.com",
  "api.deepseek.com",
  "google.com",
  "generativelanguage.googleapis.com",
])

const URL_REGEX = /(?:https?|ftp):\/\/[^\s'"<>|;&)]+/gi

const EXFILTRATION_PATTERNS = [
  // curl/wget sending file contents out
  /\bcurl\b.*?-(?:d|-data|-data-raw|-data-binary|F|--form)\s+[@'"]?[^\s'"<>|;&]*\.(?:env|pem|key|id_rsa|token|json|db|sqlite)/i,
  /\bwget\b.*?--(?:post-file|post-data)\s*[= ]\s*[@'"]?[^\s'"<>|;&]*\.(?:env|pem|key|id_rsa|token|json|db|sqlite)/i,
  // Piping sensitive files to curl/wget/nc
  /\b(?:cat|type|Get-Content)\s+[^|;&]*\.(?:env|pem|key|id_rsa|token).*?\|\s*(?:curl|wget|nc|ncat|socat|Invoke-RestMethod|iwr)\b/i,
  // Reverse shells
  /\bbash\s+-i\s+>&?\s*\/dev\/tcp\//i,
  /\bsh\s+-i\s+>&?\s*\/dev\/tcp\//i,
  /\b(?:nc|ncat|netcat)\s+.*?-e\s+(?:\/bin\/(?:ba)?sh|cmd\.exe|powershell)/i,
  /\bsocat\b.*?exec:.*?(?:bash|sh|cmd|powershell)/i,
]

const ADVERSARY_OBFUSCATION_PATTERNS = [
  // Remote pipe directly to shell
  /\b(?:curl|wget)\b.*?\|\s*(?:ba?sh|zsh|source)\b/i,
  /\b(?:iwr|Invoke-WebRequest|Invoke-RestMethod|curl)\b.*?\|\s*(?:iex|Invoke-Expression)\b/i,
  // Base64 decoded shell execution
  /\becho\s+[A-Za-z0-9+/=]{20,}\s*\|\s*base64\s+-(?:d|-decode)\s*\|\s*(?:ba?sh|zsh)/i,
  /\[System\.Convert\]::FromBase64String\(.*?\|\s*(?:iex|Invoke-Expression)/i,
  // Obfuscated python/node remote exec
  /\bpython[3]?\s+-c\s+['"].*?(?:import\s+(?:urllib|requests|socket)|exec\(urllib)/i,
  /\bnode\s+-e\s+['"].*?(?:https?\.get|fetch\(.*?\)\.then\(.*?\beval\b)/i,
]

// Commands that carry outbound data alongside a URL (upload / POST direction),
// or pipe local output into an egress-capable process.
const DATA_BEARING_FLAGS =
  /(?:^|\s)-(?:d|F|T)\b|(?:^|\s)--(?:data(?:-raw|-binary|-urlencode)?|form|upload-file|post-data|post-file)\b/i
const DATA_BEARING_POWERSHELL =
  /\b(?:iwr|Invoke-WebRequest|Invoke-RestMethod|irm)\b.*?(?:-Method\s+(?:Post|Put|Patch)|-Body|-InFile)\b/i
const PIPE_INTO_EGRESS = /\|\s*(?:curl|wget|nc|ncat|netcat|socat|telnet|ssh|rsync|scp|iwr|Invoke-WebRequest|Invoke-RestMethod)\b/i

const isDomainAllowed = (allowed: string[], domain: string): boolean =>
  allowed.some((entry) => domain === entry || domain.endsWith("." + entry))

export class EgressInspector {
  static inspectCommand(command: string, projectRoot?: string): SecurityInspectionResult {
    if (!command || typeof command !== "string") {
      return { allowed: true }
    }

    const trimmed = command.trim()

    // 1. Check exfiltration patterns
    for (const pattern of EXFILTRATION_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          category: "egress_exfiltration",
          reason: "Command attempts to exfiltrate private credentials, secrets, or spawn an interactive reverse shell.",
          remediation: "Inspect command arguments and avoid piping confidential credentials or tokens to external endpoints.",
        }
      }
    }

    // 2. Check adversary obfuscation patterns
    for (const pattern of ADVERSARY_OBFUSCATION_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          category: "adversary_injection",
          reason: "Detected uninspected remote script piped directly into shell execution (curl|sh / iwr|iex / base64|sh).",
          remediation: "Download and review external scripts before executing them, or execute build commands natively.",
        }
      }
    }

    // 3. Extract and inspect outbound URLs
    const destinations: EgressDestination[] = []
    const matches = trimmed.match(URL_REGEX) || []

    for (const urlStr of matches) {
      const safety = validateTargetUrl(urlStr)
      if (!safety.safe) {
        return {
          allowed: false,
          category: "destructive_remote",
          reason: `Target URL safety check failed: ${safety.reason || "Illegal internal or link-local address (SSRF guard)"}`,
          destinations: [{ kind: "url", target: urlStr }],
          remediation: "Ensure URL does not target loopback, RFC1918 internal addresses, or cloud metadata instances (169.254.169.254).",
        }
      }

      if (safety.parsedUrl) {
        const domain = safety.parsedUrl.hostname.toLowerCase()
        destinations.push({
          kind: "url",
          target: urlStr,
          domain,
        })
      }
    }

    // 4. Load project adversary policy (.navi/adversary.md): BLOCK and ALLOW rules
    let blockRules: string[] = []
    const allowedDomains: string[] = []
    if (projectRoot) {
      const adversaryPath = path.join(projectRoot, ".navi", "adversary.md")
      if (fs.existsSync(adversaryPath)) {
        let content: string
        try {
          content = fs.readFileSync(adversaryPath, "utf8").slice(0, 512_000)
        } catch {
          // Fail closed: an unreadable policy file must not disable enforcement
          return {
            allowed: false,
            category: "adversary_injection",
            reason: `Project security policy could not be read (${adversaryPath}); blocking command as a precaution.`,
            remediation: "Fix file permissions or remove the malformed .navi/adversary.md policy file.",
          }
        }
        const lines = content.split("\n").map((l) => l.trim())
        blockRules = lines.filter((l) => l.startsWith("BLOCK ")).map((l) => l.slice("BLOCK ".length).trim())
        for (const line of lines.filter((l) => l.startsWith("ALLOW "))) {
          const domain = line.slice("ALLOW ".length).trim().toLowerCase()
          if (domain && /^[a-z0-9._-]+$/.test(domain)) allowedDomains.push(domain)
        }
      }
    }

    // 5. Fail-closed egress: data-bearing commands may only target trusted domains
    const dataBearing = DATA_BEARING_FLAGS.test(trimmed) || DATA_BEARING_POWERSHELL.test(trimmed) || PIPE_INTO_EGRESS.test(trimmed)
    const untrustedTarget = destinations.find(
      (d) => d.domain && !EgressInspector.isDomainTrusted(d.domain) && !isDomainAllowed(allowedDomains, d.domain),
    )
    if (dataBearing && untrustedTarget?.domain) {
      return {
        allowed: false,
        category: "egress_exfiltration",
        reason: `Command sends data to non-whitelisted domain "${untrustedTarget.domain}". Read-only requests (GET) are permitted; outbound data to this domain requires an explicit ALLOW rule.`,
        destinations: [untrustedTarget],
        remediation: `If this endpoint is intentionally trusted, add "ALLOW ${untrustedTarget.domain}" to .navi/adversary.md — or remove the upload/POST flags from the command.`,
      }
    }

    // 6. BLOCK rule evaluation (boundary-aware)
    for (const ruleTarget of blockRules) {
      if (!ruleTarget) continue
      // Boundary-aware match: prevents "notevil.com" from matching BLOCK evil.com
      const escaped = ruleTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      let ruleMatches = false
      try {
        ruleMatches = new RegExp(`\\b${escaped}\\b`, "i").test(trimmed)
      } catch {
        ruleMatches = trimmed.toLowerCase().split(/\s+/).includes(ruleTarget)
      }
      if (ruleMatches) {
        return {
          allowed: false,
          category: "adversary_injection",
          reason: `Blocked by project policy rule in .navi/adversary.md: "BLOCK ${ruleTarget}"`,
          remediation: "Review project-level security policy in .navi/adversary.md.",
        }
      }
    }

    return {
      allowed: true,
      destinations,
    }
  }

  static isDomainTrusted(domain: string): boolean {
    const lowered = domain.toLowerCase()
    if (TRUSTED_DOMAINS.has(lowered)) return true
    for (const trusted of TRUSTED_DOMAINS) {
      if (lowered.endsWith("." + trusted)) return true
    }
    return false
  }
}
