import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { auditJwt, auditSecurityHeaders } from "@/security/websec"

const DESCRIPTION =
  "Audits web applications, API endpoints, HTTP security headers (CSP, HSTS, CORS), and JWT tokens for vulnerabilities."

export const Parameters = Schema.Struct({
  action: Schema.Literals(["jwt", "headers"]).annotate({
    description: "Action to perform: 'jwt' to audit JSON Web Token or 'headers' to audit HTTP response headers",
  }),
  target: Schema.String.annotate({
    description: "Target to audit: raw JWT token string (for 'jwt') or URL (for 'headers')",
  }),
})

export const SecurityAuditWebTool = Tool.define(
  "security_audit_web",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "jwt") {
            const audit = auditJwt(params.target)
            if (!audit.validStructure) {
              return {
                title: "JWT Security Audit",
                output: "❌ Invalid JWT token structure. Expected 3 base64url-encoded parts separated by dots.",
                metadata: { valid: false } as Record<string, unknown>,
              }
            }

            const lines: string[] = [
              `# 🛡️ JWT Security Audit`,
              `* Algorithm (\`alg\`): \`${String(audit.header.alg ?? "none")}\``,
              `* Type (\`typ\`): \`${String(audit.header.typ ?? "JWT")}\``,
              `* Subject (\`sub\`): \`${audit.claims.subject ?? "(none)"}\``,
              `* Issuer (\`iss\`): \`${audit.claims.issuer ?? "(none)"}\``,
              `* Expiration (\`exp\`): \`${audit.claims.expiresAt ?? "(none)"}\` ${audit.claims.isExpired ? "⚠️ **[EXPIRED]**" : "✅ [VALID]"}`,
              "",
            ]

            if (audit.vulnerabilities.length === 0) {
              lines.push("✅ **No cryptographic or token vulnerabilities identified.** Token follows secure claim standards.")
            } else {
              lines.push(`## ⚠️ Security Vulnerabilities (${audit.vulnerabilities.length})`, "")
              for (const v of audit.vulnerabilities) {
                const icon =
                  v.severity === "critical"
                    ? "🔴 [CRITICAL]"
                    : v.severity === "high"
                      ? "🟠 [HIGH]"
                      : v.severity === "medium"
                        ? "🟡 [MEDIUM]"
                        : "🔵 [LOW]"
                lines.push(`### ${icon} ${v.title}`)
                lines.push(`- **Risk**: ${v.description}`)
                lines.push(`- **Fix**: ${v.remediation}`)
                lines.push("")
              }
            }

            lines.push("## Decoded Header", "```json", JSON.stringify(audit.header, null, 2), "```", "")
            lines.push("## Decoded Payload (Non-Sensitive Claims)", "```json", JSON.stringify(audit.payload, null, 2), "```")

            return {
              title: "JWT Security Audit",
              output: lines.join("\n"),
              metadata: {
                vulnerabilities: audit.vulnerabilities.length,
                isExpired: audit.claims.isExpired,
              } as Record<string, unknown>,
            }
          }

          if (params.action === "headers") {
            const urlStr = params.target.startsWith("http") ? params.target : `https://${params.target}`
            try {
              const res = yield* Effect.promise(() =>
                fetch(urlStr, {
                  method: "HEAD",
                  headers: { "User-Agent": "Navi-Security-Audit/1.0" },
                }),
              )

              const headersRecord: Record<string, string> = {}
              res.headers.forEach((v, k) => {
                headersRecord[k] = v
              })

              const audit = auditSecurityHeaders(urlStr, headersRecord)

              const lines: string[] = [
                `# 🛡️ HTTP Security Headers Audit: \`${urlStr}\``,
                `* Status Code: \`${res.status} ${res.statusText}\``,
                `* Security Score: **${audit.score}/100**`,
                "",
              ]

              if (audit.vulnerabilities.length === 0) {
                lines.push("✅ **Excellent security header posture.** All core security headers (CSP, HSTS, X-Frame-Options, etc.) are present and properly configured.")
              } else {
                lines.push(`## ⚠️ Header Vulnerabilities (${audit.vulnerabilities.length})`, "")
                for (const v of audit.vulnerabilities) {
                  const icon = v.severity === "high" ? "🟠 [HIGH]" : v.severity === "medium" ? "🟡 [MEDIUM]" : "🔵 [LOW]"
                  lines.push(`### ${icon} ${v.title} (\`${v.header}\`)`)
                  lines.push(`- **Risk**: ${v.description}`)
                  lines.push(`- **Remediation**: ${v.remediation}`)
                  lines.push("")
                }
              }

              lines.push("## Headers Received", "```http")
              for (const [k, v] of Object.entries(audit.headersPresent)) {
                lines.push(`${k}: ${v}`)
              }
              lines.push("```")

              return {
                title: `Headers Audit: ${urlStr}`,
                output: lines.join("\n"),
                metadata: { score: audit.score, missing: audit.missingHeaders.length } as Record<string, unknown>,
              }
            } catch (e) {
              return {
                title: "Headers Audit Failed",
                output: `❌ Failed to fetch headers from ${urlStr}: ${String(e)}`,
                metadata: { error: String(e) } as Record<string, unknown>,
              }
            }
          }

          return {
            title: "Security Audit",
            output: "Invalid action specified.",
            metadata: {} as Record<string, unknown>,
          }
        }),
    }
  }),
)
