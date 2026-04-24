import { AgentRegistry, type AgentTemplate } from "../programmatic"
import INVESTIGATOR_PROMPT from "../prompt/investigator.txt"

const InvestigatorAgent: AgentTemplate = {
    id: "investigator",
    name: "Code Investigator",
    description: "Builds durable codebase maps, traces symbols, and localizes bugs quickly.",
    phase: "analyze",
    skills: ["codebase-mapping", "issue-localization"],
    tools: ["read", "list", "glob", "grep", "codesearch", "map_codebase", "investigate", "task", "question"],
    systemPrompt: INVESTIGATOR_PROMPT.trim(),
}

AgentRegistry.register(InvestigatorAgent)

export { InvestigatorAgent }
export default InvestigatorAgent
