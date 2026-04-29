import { AgentTemplate } from "../programmatic"

export const GitHubReviewer: AgentTemplate = {
    id: "github-reviewer",
    name: "GitHubReviewer",
    description: "Performs contextual code reviews for GitHub Pull Requests",
    tools: ["read", "grep", "ls", "bash", "google-search"],
    phase: "analyze",
    skills: ["code-review", "github-integration", "security-audit"],
}
