export interface JwtAuditResult {
  validStructure: boolean
  header: Record<string, unknown>
  payload: Record<string, unknown>
  vulnerabilities: Array<{
    severity: "critical" | "high" | "medium" | "low"
    title: string
    description: string
    remediation: string
  }>
  claims: {
    issuer?: string
    subject?: string
    audience?: string
    issuedAt?: string
    expiresAt?: string
    isExpired?: boolean
  }
}

export interface HeaderAuditResult {
  url: string
  score: number // 0 - 100
  headersPresent: Record<string, string>
  missingHeaders: string[]
  vulnerabilities: Array<{
    severity: "high" | "medium" | "low"
    header: string
    title: string
    description: string
    remediation: string
  }>
}

export function auditJwt(token: string): JwtAuditResult {
  const parts = token.trim().split(".")
  if (parts.length !== 3) {
    return {
      validStructure: false,
      header: {},
      payload: {},
      vulnerabilities: [
        {
          severity: "high",
          title: "Malformed JWT Format",
          description: "Token does not conform to 3-part header.payload.signature structure.",
          remediation: "Ensure the token is properly Base64URL-encoded RFC 7519 JSON Web Token.",
        },
      ],
      claims: {},
    }
  }

  const decodeB64Url = (str: string): Record<string, unknown> => {
    try {
      const b64 = str.replace(/-/g, "+").replace(/_/g, "/")
      const pad = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")
      const json = Buffer.from(pad, "base64").toString("utf-8")
      return JSON.parse(json)
    } catch {
      return {}
    }
  }

  const header = decodeB64Url(parts[0]!)
  const payload = decodeB64Url(parts[1]!)
  const vulnerabilities: JwtAuditResult["vulnerabilities"] = []

  const alg = String(header.alg || "").toLowerCase()

  // 1. Algorithm "none" Vulnerability (CVE-2015-9235)
  if (!alg || alg === "none") {
    vulnerabilities.push({
      severity: "critical",
      title: "Insecure 'none' Algorithm Allowed",
      description: "The token header specifies 'alg: none' or lacks an algorithm, allowing attackers to forge arbitrary tokens without a signature.",
      remediation: "Enforce strict algorithm verification on the server. Reject tokens with 'none' algorithm.",
    })
  }

  // 2. Weak Symmetric Algorithm
  if (alg === "hs256") {
    vulnerabilities.push({
      severity: "low",
      title: "Symmetric HMAC Algorithm in Use",
      description: "HS256 uses a shared secret that may be vulnerable to offline brute-force if secret entropy is low (< 256 bits).",
      remediation: "Ensure HMAC secret is >= 32 random bytes or use asymmetric signing (RS256 / EdDSA).",
    })
  }

  // 3. Expiration Check
  const now = Math.floor(Date.now() / 1000)
  let isExpired = false
  if (typeof payload.exp === "number") {
    if (payload.exp < now) {
      isExpired = true
      vulnerabilities.push({
        severity: "medium",
        title: "Expired JWT Token",
        description: `Token expired at ${new Date(payload.exp * 1000).toISOString()}.`,
        remediation: "Verify tokens are refreshed via secure refresh rotation and expired tokens are rejected.",
      })
    }
  } else {
    vulnerabilities.push({
      severity: "medium",
      title: "Missing 'exp' Expiration Claim",
      description: "Token does not define an expiration timestamp, making it valid indefinitely if leaked.",
      remediation: "Always set an 'exp' claim with a reasonable lifespan (e.g. 15-60 minutes for access tokens).",
    })
  }

  // 4. Sensitive Data Exposure in Payload
  const sensitiveKeys = ["password", "secret", "private_key", "ssn", "credit_card", "api_key"]
  for (const key of Object.keys(payload)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
      vulnerabilities.push({
        severity: "high",
        title: `Sensitive Field '${key}' in Payload`,
        description: "JWT payloads are Base64URL-encoded (not encrypted) and readable by anyone who possesses the token.",
        remediation: "Never include passwords, credentials, or sensitive PII in JWT payloads. Use opaque tokens or JWE (encrypted JWT).",
      })
    }
  }

  return {
    validStructure: true,
    header,
    payload,
    vulnerabilities,
    claims: {
      issuer: payload.iss as string | undefined,
      subject: payload.sub as string | undefined,
      audience: payload.aud as string | undefined,
      issuedAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : undefined,
      expiresAt: typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : undefined,
      isExpired,
    },
  }
}

export function auditSecurityHeaders(url: string, headers: Record<string, string>): HeaderAuditResult {
  const norm: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    norm[k.toLowerCase()] = v
  }

  const vulnerabilities: HeaderAuditResult["vulnerabilities"] = []
  const missingHeaders: string[] = []
  let score = 100

  // 1. Content-Security-Policy (CSP)
  const csp = norm["content-security-policy"]
  if (!csp) {
    missingHeaders.push("Content-Security-Policy")
    score -= 25
    vulnerabilities.push({
      severity: "high",
      header: "Content-Security-Policy",
      title: "Missing Content Security Policy",
      description: "Without CSP, the browser has no defense-in-depth against Cross-Site Scripting (XSS) and data exfiltration.",
      remediation: "Configure a strict Content-Security-Policy header restricting script-src, object-src, and default-src.",
    })
  } else if (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'")) {
    score -= 10
    vulnerabilities.push({
      severity: "medium",
      header: "Content-Security-Policy",
      title: "Weak CSP Directives ('unsafe-inline' / 'unsafe-eval')",
      description: "CSP allows inline scripts or eval(), weakening protection against XSS payloads.",
      remediation: "Use nonces or hashes for inline scripts and avoid eval().",
    })
  }

  // 2. Strict-Transport-Security (HSTS)
  if (!norm["strict-transport-security"]) {
    missingHeaders.push("Strict-Transport-Security")
    score -= 20
    vulnerabilities.push({
      severity: "high",
      header: "Strict-Transport-Security",
      title: "Missing HSTS Header",
      description: "Without HSTS, connections can be downgraded to plain HTTP via SSLStrip attacks.",
      remediation: "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains; preload'.",
    })
  }

  // 3. X-Frame-Options (Clickjacking)
  if (!norm["x-frame-options"] && (!csp || !csp.includes("frame-ancestors"))) {
    missingHeaders.push("X-Frame-Options")
    score -= 15
    vulnerabilities.push({
      severity: "medium",
      header: "X-Frame-Options",
      title: "Missing Clickjacking Protection",
      description: "Page can be embedded in malicious iframes to hijack user clicks.",
      remediation: "Set 'X-Frame-Options: DENY' or 'frame-ancestors 'none'' in CSP.",
    })
  }

  // 4. X-Content-Type-Options
  if (norm["x-content-type-options"] !== "nosniff") {
    missingHeaders.push("X-Content-Type-Options")
    score -= 10
    vulnerabilities.push({
      severity: "low",
      header: "X-Content-Type-Options",
      title: "MIME-Type Sniffing Protection Disabled",
      description: "Browsers may sniff response content types, potentially treating user uploads as executable HTML/JS.",
      remediation: "Set 'X-Content-Type-Options: nosniff'.",
    })
  }

  // 5. CORS Misconfiguration Check
  const acao = norm["access-control-allow-origin"]
  const acac = norm["access-control-allow-credentials"]
  if (acao === "*" && acac === "true") {
    score -= 20
    vulnerabilities.push({
      severity: "high",
      header: "Access-Control-Allow-Origin",
      title: "Overly Permissive CORS with Credentials",
      description: "Wildcard origin '*' with credentials 'true' is invalid or indicates dangerous cross-origin policy.",
      remediation: "Specify explicit trusted origins in Access-Control-Allow-Origin.",
    })
  }

  // 6. Information Disclosure Headers (Server, X-Powered-By)
  if (norm["server"] || norm["x-powered-by"]) {
    score -= 10
    vulnerabilities.push({
      severity: "low",
      header: norm["x-powered-by"] ? "X-Powered-By" : "Server",
      title: "Server Banner Information Disclosure",
      description: `Server leaks backend technology banners (${norm["x-powered-by"] || norm["server"]}), facilitating targeted exploits.`,
      remediation: "Suppress Server and X-Powered-By response headers in web server or reverse proxy configuration.",
    })
  }

  return {
    url,
    score: Math.max(0, score),
    headersPresent: norm,
    missingHeaders,
    vulnerabilities,
  }
}
