import fs from "node:fs"
import path from "node:path"
import { shannonEntropy } from "@/sandbox"

export type Severity = "critical" | "high" | "medium" | "low" | "info"

export interface SecurityFinding {
  id: string
  rule: string
  title: string
  cwe: string
  owasp: string
  severity: Severity
  file: string
  line: number
  snippet: string
  description: string
  remediation: string
}

export interface ScanResult {
  root: string
  scannedFiles: number
  findings: SecurityFinding[]
  summary: {
    critical: number
    high: number
    medium: number
    low: number
    info: number
    total: number
  }
}

interface SastRule {
  id: string
  title: string
  cwe: string
  owasp: string
  severity: Severity
  extensions: string[]
  regex: RegExp
  description: string
  remediation: string
}

const SAST_RULES: SastRule[] = [
  // ── SQL Injection (CWE-89) ──
  {
    id: "SEC-SQLI-01",
    title: "SQL Injection via String Concatenation",
    cwe: "CWE-89",
    owasp: "A03:2021-Injection",
    severity: "critical",
    extensions: [".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".php"],
    regex: /(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\s+.*?\s+(?:WHERE|SET|FROM|INTO)\s+.*?(?:\+\s*["']?\w+|`\$\{[^}]+\}`|f["'][^"']*\{[^}]+\}["']|\.format\(|\%s|\$_(?:GET|POST|REQUEST)\[)/i,
    description: "Dynamically constructing SQL queries from string concatenation or template interpolation allows SQL Injection attacks.",
    remediation: "Use parameterized queries, prepared statements, or an ORM with type-safe query builders.",
  },

  // ── Command Injection / RCE (CWE-78) ──
  {
    id: "SEC-CMDI-01",
    title: "Command Injection via Unsanitized Shell Execution",
    cwe: "CWE-78",
    owasp: "A03:2021-Injection",
    severity: "critical",
    extensions: [".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".php"],
    regex: /(?:exec|execSync|spawn|os\.system|subprocess\.Popen|subprocess\.run|shell_exec|system|passthru)\s*\(\s*(?:`[^`]*\$\{[^}]+\}`|["'][^"']*["']\s*\+|[a-zA-Z0-9_]+\s*\+|f["'][^"']*\{[^}]+\}["']|\$_(?:GET|POST)\[)/,
    description: "Executing system shell commands with concatenated variables can allow arbitrary Remote Code Execution (RCE).",
    remediation: "Pass arguments as an array to spawn() without shell: true, or use strict allowlists and sandbox containment.",
  },

  // ── Server-Side Request Forgery / SSRF (CWE-918) ──
  {
    id: "SEC-SSRF-01",
    title: "Potential Server-Side Request Forgery (SSRF)",
    cwe: "CWE-918",
    owasp: "A10:2021-SSRF",
    severity: "high",
    extensions: [".ts", ".js", ".py", ".go"],
    regex: /(?:fetch|axios\.(?:get|post)|http\.get|urllib\.request\.urlopen|requests\.(?:get|post))\s*\(\s*(?:req\.(?:query|body|params)|request\.(?:GET|POST|args)|ctx\.query|ctx\.request)\./,
    description: "Making HTTP requests directly to user-supplied URLs can allow internal network scanning or metadata service compromise.",
    remediation: "Validate destination URLs against an allowlist of trusted hosts and block private IP ranges (127.0.0.1, 10.0.0.0/8, 169.254.169.254).",
  },

  // ── Path Traversal (CWE-22) ──
  {
    id: "SEC-PATH-01",
    title: "Path Traversal / Arbitrary File Access",
    cwe: "CWE-22",
    owasp: "A01:2021-Broken Access Control",
    severity: "high",
    extensions: [".ts", ".js", ".py", ".go", ".php"],
    regex: /(?:fs\.(?:readFileSync|readFile|createReadStream|writeFileSync|writeFile)|open\(|os\.path\.join\(.*?request\.)\s*\(\s*(?:path\.join\(.*?(?:req\.|request\.)|(?:req\.|request\.)(?:query|params|body|GET|POST)|["'][^"']*["']\s*\+\s*[a-zA-Z0-9_]+|`[^`]*\$\{[^}]+\}`)/i,
    description: "Reading or writing files using unsanitized user path parameters allows attackers to escape root via '..' sequences.",
    remediation: "Canonicalize paths using path.resolve() and verify they remain within the intended root directory via containment checks.",
  },

  // ── Cross-Site Scripting / XSS (CWE-79) ──
  {
    id: "SEC-XSS-01",
    title: "Cross-Site Scripting (XSS) via Raw HTML Injection",
    cwe: "CWE-79",
    owasp: "A03:2021-Injection",
    severity: "medium",
    extensions: [".tsx", ".jsx", ".ts", ".js", ".html"],
    regex: /(?:dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:|\.innerHTML\s*=|\.outerHTML\s*=|\$\([^)]+\)\.html\s*\()/i,
    description: "Injecting unescaped user content directly into HTML DOM properties can enable stored or reflected Cross-Site Scripting.",
    remediation: "Use safe text content binding (e.g. textContent), React standard JSX escaping, or sanitize HTML with DOMPurify.",
  },

  // ── Insecure Deserialization (CWE-502) ──
  {
    id: "SEC-DESER-01",
    title: "Insecure Deserialization",
    cwe: "CWE-502",
    owasp: "A08:2021-Software and Data Integrity Failures",
    severity: "critical",
    extensions: [".py", ".js", ".php"],
    regex: /(?:pickle\.loads|pickle\.load|yaml\.load\([^,)]+\)|unserialize\s*\(|node-serialize)/,
    description: "Deserializing untrusted data with unsafe deserializers can lead to arbitrary code execution or object injection.",
    remediation: "Use safe serializers like json.loads() or yaml.safe_load(), or cryptographically sign serialized payloads with HMAC.",
  },

  // ── Weak Cryptography (CWE-327 / CWE-328) ──
  {
    id: "SEC-CRYPTO-01",
    title: "Use of Broken or Weak Cryptographic Hash (MD5 / SHA1)",
    cwe: "CWE-328",
    owasp: "A02:2021-Cryptographic Failures",
    severity: "medium",
    extensions: [".ts", ".js", ".py", ".go", ".rs", ".java"],
    regex: /(?:createHash\s*\(\s*["'](?:md5|sha1)["']|hashlib\.(?:md5|sha1)\s*\(|crypto\.MD5|crypto\.SHA1)/i,
    description: "MD5 and SHA-1 have known collision vulnerabilities and should not be used for security-sensitive hashing or signatures.",
    remediation: "Upgrade to SHA-256 (SHA-2), SHA-3, or password-hashing algorithms (Argon2id, bcrypt, scrypt).",
  },

  // ── Insecure Randomness (CWE-338) ──
  {
    id: "SEC-RAND-01",
    title: "Cryptographically Insecure Pseudorandom Number Generator",
    cwe: "CWE-338",
    owasp: "A02:2021-Cryptographic Failures",
    severity: "low",
    extensions: [".ts", ".js", ".py"],
    regex: /(?:Math\.random\(\)|random\.random\(\)|random\.randint\()/i,
    description: "Math.random() and python random are not cryptographically secure and produce predictable values when used for tokens/secrets.",
    remediation: "Use crypto.getRandomValues() or crypto.randomBytes() (Node/Web) or secrets module (Python).",
  },

  // ── Hardcoded Secret / Credential (CWE-798) ──
  {
    id: "SEC-SECRET-01",
    title: "Hardcoded API Key or Private Secret",
    cwe: "CWE-798",
    owasp: "A07:2021-Identification and Authentication Failures",
    severity: "high",
    extensions: [".ts", ".js", ".py", ".go", ".rs", ".json", ".env", ".yaml", ".yml"],
    regex: /(?:sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35}|ghp_[a-zA-Z0-9]{36,}|xox[baprs]-[0-9]{10,13}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA )?PRIVATE KEY-----)/,
    description: "Hardcoded credentials or API keys committed to source code lead to credential compromise.",
    remediation: "Store secrets in environment variables or a dedicated secrets manager (AWS KMS, HashiCorp Vault) and add keys to .gitignore.",
  },
]

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  "vendor",
  "coverage",
])

export function scanSourceFile(filePath: string, content: string): SecurityFinding[] {
  const ext = path.extname(filePath).toLowerCase()
  const findings: SecurityFinding[] = []
  const lines = content.split("\n")

  for (const rule of SAST_RULES) {
    if (!rule.extensions.includes(ext) && !rule.extensions.includes("*")) continue

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const trimmed = line.trim()
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        continue
      }

      if (rule.regex.test(line)) {
        findings.push({
          id: `${rule.id}-${i + 1}`,
          rule: rule.id,
          title: rule.title,
          cwe: rule.cwe,
          owasp: rule.owasp,
          severity: rule.severity,
          file: filePath.replace(/\\/g, "/"),
          line: i + 1,
          snippet: trimmed.slice(0, 160),
          description: rule.description,
          remediation: rule.remediation,
        })
      }
    }
  }

  // Shannon entropy detector for long unquoted secrets (e.g. secret_key = "...")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const secretMatch = /(?:secret|password|token|api_key|apikey|auth_token)\s*[:=]\s*["']([A-Za-z0-9+/=_-]{24,})["']/i.exec(line)
    if (secretMatch && secretMatch[1]) {
      const val = secretMatch[1]
      if (shannonEntropy(val) >= 3.7 && !val.includes("REDACTED") && !val.includes("EXAMPLE")) {
        findings.push({
          id: `SEC-ENTROPY-${i + 1}`,
          rule: "SEC-SECRET-ENTROPY",
          title: "High-Entropy Hardcoded Secret Assignment",
          cwe: "CWE-798",
          owasp: "A07:2021-Identification and Authentication Failures",
          severity: "high",
          file: filePath.replace(/\\/g, "/"),
          line: i + 1,
          snippet: line.trim().slice(0, 120),
          description: "Variable assignment with high Shannon entropy detected, indicating hardcoded cryptographic secret or token.",
          remediation: "Load secret values dynamically from environment variables.",
        })
      }
    }
  }

  return findings
}

export function scanWorkspace(
  targetDir: string,
  options?: {
    maxFiles?: number
    severityFilter?: Severity[]
  },
): ScanResult {
  const root = path.resolve(targetDir)
  const findings: SecurityFinding[] = []
  let scannedFiles = 0
  const max = options?.maxFiles ?? 2500

  function walk(current: string) {
    if (scannedFiles >= max) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (scannedFiles >= max) break
      const fullPath = path.join(current, entry.name)

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(fullPath)
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if ([".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".php", ".json", ".env"].includes(ext)) {
          try {
            const stat = fs.statSync(fullPath)
            if (stat.size > 2 * 1024 * 1024) continue // Skip giant files > 2MB
            const content = fs.readFileSync(fullPath, "utf-8")
            scannedFiles++
            const fileFindings = scanSourceFile(path.relative(root, fullPath), content)
            findings.push(...fileFindings)
          } catch {
            // Ignore unreadable files
          }
        }
      }
    }
  }

  walk(root)

  const filtered = options?.severityFilter
    ? findings.filter((f) => options.severityFilter!.includes(f.severity))
    : findings

  const summary = {
    critical: filtered.filter((f) => f.severity === "critical").length,
    high: filtered.filter((f) => f.severity === "high").length,
    medium: filtered.filter((f) => f.severity === "medium").length,
    low: filtered.filter((f) => f.severity === "low").length,
    info: filtered.filter((f) => f.severity === "info").length,
    total: filtered.length,
  }

  return {
    root: root.replace(/\\/g, "/"),
    scannedFiles,
    findings: filtered,
    summary,
  }
}
