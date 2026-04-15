import { AgentTemplate } from "../programmatic"

/**
 * DevOpsDynamo Agent
 * Phase: Deploy
 * Responsibility: Infrastructure, CI/CD pipelines, and environment management.
 */
export const DevOpsDynamo: AgentTemplate = {
    id: "devops-dynamo",
    name: "DevOpsDynamo",
    description: "Expert in infrastructure, deployment pipelines, and environment configuration",
    tools: ["read", "write", "terminal"],
    phase: "deploy",
    skills: ["finishing-a-development-branch", "using-git-worktrees", "receiving-code-review", "requesting-code-review"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Infra Review", description: "Analyzing infrastructure requirements and dependencies" }
        yield { type: "log", message: "Configuring deployment workflows and container orchestration..." }
        yield { type: "step", name: "Pipeline Construction", description: "Building robust CI/CD integration pipelines" }
        yield { type: "step", name: "Env Verification", description: "Ensuring environment parity and configuration health" }
        yield { type: "finish", result: "Deployment pipeline and environment stabilized." }
    }
}
