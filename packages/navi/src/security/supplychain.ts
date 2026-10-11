import fs from "node:fs"
import path from "node:path"

export interface SupplyChainFinding {
  type: "dependency" | "dockerfile" | "lockfile"
  target: string
  package?: string
  version?: string
  severity: "critical" | "high" | "medium" | "low"
  title: string
  description: string
  remediation: string
}

// Known compromised or dangerous packages
const COMPROMISED_PACKAGES: Record<string, { versions: string[]; reason: string }> = {
  "event-stream": { versions: ["3.3.6"], reason: "Cryptojacking malware backdoor injected via flatmap-stream dependency" },
  "flatmap-stream": { versions: ["*"], reason: "Malicious package targeting Bitcoin wallet keys" },
  "colors": { versions: ["1.4.1", "1.4.2"], reason: "Protestware denial of service release causing infinite loop" },
  "faker": { versions: ["6.6.6"], reason: "Protestware release wiping output" },
  "ua-parser-js": { versions: ["0.7.29", "0.8.0", "1.0.0"], reason: "Account takeover cryptominer and password stealer" },
  "coa": { versions: ["2.0.3", "2.0.4"], reason: "Credential stealer / Danabot malware payload" },
  "rc": { versions: ["1.2.9", "1.3.9"], reason: "Danabot credential stealer payload" },
}

export function auditPackageJson(filePath: string): SupplyChainFinding[] {
  const findings: SupplyChainFinding[] = []
  if (!fs.existsSync(filePath)) return findings

  try {
    const raw = fs.readFileSync(filePath, "utf-8")
    const pkg = JSON.parse(raw)
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    }

    for (const [name, ver] of Object.entries(allDeps)) {
      const verStr = String(ver)
      const compromised = COMPROMISED_PACKAGES[name]
      if (compromised) {
        if (compromised.versions.includes("*") || compromised.versions.some((v) => verStr.includes(v))) {
          findings.push({
            type: "dependency",
            target: filePath,
            package: name,
            version: verStr,
            severity: "critical",
            title: `Known Malicious/Compromised Dependency: ${name}`,
            description: compromised.reason,
            remediation: `Remove '${name}' immediately or pin to a known safe version.`,
          })
        }
      }

      // Check git / http tarball dependencies
      if (verStr.startsWith("http:") || verStr.startsWith("git://")) {
        findings.push({
          type: "dependency",
          target: filePath,
          package: name,
          version: verStr,
          severity: "high",
          title: `Insecure Unencrypted Package URL: ${name}`,
          description: `Dependency resolves over unencrypted plaintext protocol (${verStr}), vulnerable to MitM tampering.`,
          remediation: `Update dependency reference to HTTPS or official npm registry.`,
        })
      }
    }
  } catch {
    // Malformed package.json
  }

  return findings
}

export function auditDockerfile(filePath: string): SupplyChainFinding[] {
  const findings: SupplyChainFinding[] = []
  if (!fs.existsSync(filePath)) return findings

  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n")

    let hasUserInstruction = false
    let hasLatestTag = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim()
      if (line.startsWith("#") || !line) continue

      // Check unpinned base image (FROM ...:latest or without tag)
      if (/^FROM\s+[^\s:]+(?::latest)?(?:\s+AS\s+\w+)?$/i.test(line)) {
        hasLatestTag = true
        findings.push({
          type: "dockerfile",
          target: filePath,
          severity: "medium",
          title: "Unpinned Docker Base Image",
          description: `Line ${i + 1}: Base image does not specify an immutable digest or specific version tag.`,
          remediation: "Pin base image to an immutable digest (e.g. image@sha256:...) or specific minor tag.",
        })
      }

      // Check for curl | sh execution
      if (/curl\s+.*?\|\s*(?:sh|bash)/i.test(line) || /wget\s+.*?\|\s*(?:sh|bash)/i.test(line)) {
        findings.push({
          type: "dockerfile",
          target: filePath,
          severity: "high",
          title: "Piped Shell Script Execution via curl/wget",
          description: `Line ${i + 1}: Downloading and directly executing shell scripts from the web bypasses verification.`,
          remediation: "Download script, verify its cryptographic checksum (sha256sum), and then execute.",
        })
      }

      // Check for secrets copied or baked into ENV
      if (/^ENV\s+.*?(?:api_key|secret|password|token)\s*=/i.test(line)) {
        findings.push({
          type: "dockerfile",
          target: filePath,
          severity: "critical",
          title: "Hardcoded Secret Baked into Docker Layer",
          description: `Line ${i + 1}: Storing secrets in Docker ENV instructions persists them in the public image metadata.`,
          remediation: "Inject credentials at runtime using secret mounts (--mount=type=secret) or environment variables.",
        })
      }

      if (/^USER\s+/i.test(line) && !line.includes("root") && !line.includes("0")) {
        hasUserInstruction = true
      }
    }

    if (!hasUserInstruction) {
      findings.push({
        type: "dockerfile",
        target: filePath,
        severity: "medium",
        title: "Container Defaults to Root Execution",
        description: "Dockerfile does not contain a non-root USER instruction. Processes run with root privileges in the container.",
        remediation: "Add a non-root user (e.g. 'USER appuser' or 'USER 1000:1000') before the ENTRYPOINT/CMD.",
      })
    }
  } catch {
    // Unreadable
  }

  return findings
}

export function auditWorkspaceSupplyChain(workspaceRoot: string): SupplyChainFinding[] {
  const findings: SupplyChainFinding[] = []
  const pkgJson = path.join(workspaceRoot, "package.json")
  if (fs.existsSync(pkgJson)) {
    findings.push(...auditPackageJson(pkgJson))
  }

  const dockerfile = path.join(workspaceRoot, "Dockerfile")
  if (fs.existsSync(dockerfile)) {
    findings.push(...auditDockerfile(dockerfile))
  }

  return findings
}
