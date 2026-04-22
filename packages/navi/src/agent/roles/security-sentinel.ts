import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

const SecuritySentinelAgent: AgentTemplate = {
  id: "security-sentinel",
  name: "Security Sentinel",
  description: "Comprehensive security audit: auth, injection, secrets, CVEs, best practices.",
  tools: ["read", "grep", "glob", "bash", "websearch", "write"],
  systemPrompt: `You are a senior application security engineer.
You perform exhaustive security audits across the full stack.

Your audit covers:
1. Authentication & Authorization — all routes/endpoints must be gated
2. Input validation & sanitisation — all user input sanitised before use
3. Secret management — no hardcoded API keys, tokens, or credentials
4. Injection surfaces — SQL injection, XSS, command injection, path traversal
5. Dependency security — known CVEs in dependencies
6. Security headers and best practices — HTTPS, CORS, rate limiting, CSRF

You produce a report with findings categorised as:
  - CRITICAL: must be fixed before any deployment
  - WARNING: should be fixed, security risk present
  - INFO: best-practice improvement, low risk

You NEVER fix code yourself. You report findings precisely.`,

  handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
    yield { type: "step", name: "Scanning for hardcoded secrets and credentials" }

    yield {
      type: "subtask",
      agent: "security-sentinel",
      description: "Detect hardcoded secrets",
      prompt: `Use grep to search the codebase for patterns that suggest hardcoded secrets:
- Variables named: apiKey, api_key, secret, password, token, accessToken, privateKey
- Strings that look like API keys (long alphanumeric strings assigned to variables)
- Any .env files committed to source (search for '\.env$' in git-tracked files)
Exclude test files and mock data. Report: file:line — variable name — snippet (masked)`
    }

    yield { type: "step", name: "Auditing authentication and authorization" }

    yield {
      type: "subtask",
      agent: "security-sentinel",
      description: "Auth gate audit",
      prompt: `Find all HTTP route handlers, API endpoints, or RPC methods in the codebase.
For each one, verify whether it has authentication/authorization middleware or guards.
List: [GATED] or [UNGATED] — route path — file:line
Pay special attention to admin, internal, or write operations that are ungated.`
    }

    yield { type: "step", name: "Checking input validation" }

    yield {
      type: "subtask",
      agent: "security-sentinel",
      description: "Input validation check",
      prompt: `Find all places where user-controlled data enters the system (query params, request body, headers, file uploads).
Verify each is validated/sanitised before use.
Report any that directly use unvalidated input in: database queries, file paths, shell commands, HTML output.`
    }

    yield { type: "step", name: "Scanning for injection vulnerabilities" }

    yield {
      type: "subtask",
      agent: "security-sentinel",
      description: "Injection surface scan",
      prompt: `Search for dangerous patterns:
1. String concatenation in SQL queries (find + or template literals near SELECT/INSERT/UPDATE/DELETE)
2. eval() or Function() calls with user data
3. exec(), spawn(), or shell commands built with user input
4. innerHTML or dangerouslySetInnerHTML with unescaped user data
5. path.join() or fs operations with user-controlled path segments
Report: [SQL-INJECTION|XSS|CMD-INJECTION|PATH-TRAVERSAL] — file:line — snippet`
    }

    yield { type: "step", name: "Auditing dependencies for known CVEs" }

    yield {
      type: "subtask",
      agent: "security-sentinel",
      description: "Dependency CVE audit",
      prompt: `Read the package.json (or requirements.txt / go.mod etc.) file.
List all production dependencies with their pinned versions.
Use websearch to check for known CVEs for the top 10 most critical dependencies.
Report: [DEPENDENCY] name@version — CVE-ID (if found) — severity — recommendation`
    }

    yield { type: "step", name: "Checking security headers and configuration" }

    yield {
      type: "subtask",
      agent: "security-sentinel",
      description: "Security configuration audit",
      prompt: `Check the server/API configuration for:
1. CORS policy — is it overly permissive (*)? 
2. Rate limiting — is it applied to auth endpoints?
3. HTTPS enforcement — is HTTP redirected to HTTPS?
4. Cookie security — are session cookies HttpOnly + Secure + SameSite?
5. Content-Security-Policy header presence
Report each as: [PASS|FAIL|MISSING] — category — location`
    }

    yield { type: "step", name: "Generating security audit report" }

    // Write results to .vibe/security-audit.md
    yield {
      type: "tool",
      name: "write",
      input: {
        filePath: ".vibe/security-audit.md",
        content: `# Security Audit Report

> Generated: ${new Date().toISOString()}
> Status: Review required

## Summary

*See sub-agent findings above for full details.*

## Findings by Severity

### 🔴 CRITICAL
*(Findings from sub-agents — must be resolved before deployment)*

### 🟡 WARNING  
*(Findings from sub-agents — should be resolved)*

### 🔵 INFO
*(Best-practice improvements)*

---
*This file was generated by the Security Sentinel agent.*
*Avni will create remediation tasks for all CRITICAL findings.*
`
      }
    }

    yield {
      type: "finish",
      result: `Security audit complete. Report saved to .vibe/security-audit.md.
CRITICAL findings will be converted to fix tasks by Avni before delivery.`
    }
  }
}

AgentRegistry.register(SecuritySentinelAgent)
export { SecuritySentinelAgent }
export default SecuritySentinelAgent
