import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

const ReviewerAgent: AgentTemplate = {
    id: "reviewer",
    name: "Code Reviewer",
    description: "Evaluates code changes for correctness and quality",
    tools: ["read", "write", "edit", "bash"],
    handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
        yield { type: "step", name: "Reviewing code" }

        // 1. Run tests or lint
        yield { type: "log", message: "Running lint checks..." }
        const lintResult = yield {
            type: "tool",
            name: "bash",
            input: { command: "npm run lint" }
        }

        // 2. Analyze quality
        const score = lintResult?.includes("error") ? "FAIL" : "PASS"

        yield { type: "finish", result: `Review complete. Status: ${score}` }
    }
}

AgentRegistry.register(ReviewerAgent)
export { ReviewerAgent }


