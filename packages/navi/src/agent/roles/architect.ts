import { AgentRegistry, type AgentTemplate } from "../programmatic"
import ARCHITECT_PROMPT from "../prompt/architect.txt"

const ArchitectAgent: AgentTemplate = {
    id: "architect",
    name: "Navi Architect",
    description: "High-level design and system synthesis specialist.",
    phase: "design",
    skills: ["architecture", "planning"],
    tools: ["read", "list", "glob", "grep", "codesearch", "task", "parallel", "question"],
    systemPrompt: ARCHITECT_PROMPT.trim(),
}

AgentRegistry.register(ArchitectAgent)

export { ArchitectAgent }
export default ArchitectAgent
