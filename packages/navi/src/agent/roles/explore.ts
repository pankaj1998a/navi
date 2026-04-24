import { AgentRegistry, type AgentTemplate } from "../programmatic"
import EXPLORE_PROMPT from "../prompt/explore.txt"

const ExploreAgent: AgentTemplate = {
    id: "explore",
    name: "Code Explorer",
    description: "Rapidly explores local codebases and finds the highest-signal files and symbols.",
    phase: "analyze",
    skills: ["exploration", "file-search"],
    tools: ["read", "list", "glob", "grep", "codesearch", "task", "question"],
    systemPrompt: EXPLORE_PROMPT.trim(),
}

AgentRegistry.register(ExploreAgent)

export { ExploreAgent }
export default ExploreAgent
