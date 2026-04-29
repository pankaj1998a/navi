import { AgentTemplate } from "../programmatic"

export const GitHubTriage: AgentTemplate = {
    id: "github-triage",
    name: "GitHubTriage",
    description: "Triages GitHub issues and suggests labels/priority",
    tools: ["bash", "read"],
    phase: "analyze",
    skills: ["issue-triage", "github-integration", "project-management"],
}
