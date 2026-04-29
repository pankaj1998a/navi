import { AgentTemplate } from "../programmatic"

export const ReleaseGenerator: AgentTemplate = {
    id: "release-notes",
    name: "ReleaseGenerator",
    description: "Generates user-friendly release notes from commits and PRs",
    tools: ["bash", "read"],
    phase: "analyze",
    skills: ["release-notes", "technical-writing", "git-analysis"],
}
