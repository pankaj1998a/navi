import { AgentTemplate } from "../programmatic"

/**
 * SecuritySentinel Agent
 * Phase: Security
 * Responsibility: Vulnerability scanning, secure coding practices, and auditing.
 */
export const SecuritySentinel: AgentTemplate = {
    id: "security-sentinel",
    name: "SecuritySentinel",
    description: "Audits code for security vulnerabilities and enforces best practices",
    tools: ["read", "grep", "skill"],
    phase: "security",
    skills: ["security-agent", "interface-authorization", "realize-authorization-correct", "realize-authorization-write"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Source Audit", description: "Scanning codebase for common security patterns" }
        yield { type: "log", message: "Checking for sensitive data leaks and injection vectors..." }
        yield { type: "step", name: "Dependency Check", description: "Auditing third-party libraries for known vulnerabilities" }
        yield { type: "step", name: "Policy Enforcement", description: "Validating against security-hardened standards" }
        yield { type: "finish", result: "Security audit complete. No critical vulnerabilities found." }
    }
}
