import { AgentRegistry, type AgentTemplate } from "../programmatic"
import TESTER_PROMPT from "../prompt/tester.txt"

const TesterAgent: AgentTemplate = {
    id: "tester",
    name: "Navi Tester",
    description: "Writes and runs tests to validate behavior and catch regressions.",
    phase: "test",
    skills: ["testing", "verification"],
    tools: ["read", "list", "glob", "grep", "codesearch", "bash", "edit", "write", "question"],
    systemPrompt: TESTER_PROMPT.trim(),
}

AgentRegistry.register(TesterAgent)

export { TesterAgent }
export default TesterAgent
