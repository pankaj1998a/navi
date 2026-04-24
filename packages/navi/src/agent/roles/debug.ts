import { AgentRegistry, type AgentTemplate } from "../programmatic"
import DEBUG_PROMPT from "../prompt/debug.txt"

const DebugAgent: AgentTemplate = {
    id: "debug",
    name: "Navi Debugger",
    description: "Finds root causes and guides fixes for software bugs.",
    phase: "debug",
    skills: ["debugging", "root-cause-analysis"],
    tools: ["read", "list", "glob", "grep", "codesearch", "bash", "edit", "patch", "question"],
    systemPrompt: DEBUG_PROMPT.trim(),
}

AgentRegistry.register(DebugAgent)

export { DebugAgent }
export default DebugAgent
