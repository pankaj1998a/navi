import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

const PlannerAgent: AgentTemplate = {
    id: "planner",
    name: "Architect Planner",
    description: "Analyzes requirements and creates a detailed execution plan",
    phase: "analyze",
    skills: ["planning"],
    tools: ["read", "grep", "write", "edit", "bash"],
    handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
        yield { type: "step", name: "Analyzing requirements", description: context.input }

        // 1. Explore the codebase
        yield { type: "log", message: "Exploring codebase to understand context..." }
        const searchResult = yield {
            type: "tool",
            name: "grep",
            input: { query: context.input, path: ["./src"] }
        }

        // 2. Generate the plan (Simulated)
        yield { type: "log", message: "Drafting execution plan..." }

        const plan = `
# Execution Plan for: ${context.input}

1. **Step 1**: Analyze existing implementation in relevant files.
2. **Step 2**: Implement changes using the Editor agent.
3. **Step 3**: Verify changes with the Reviewer agent.

Files identified: ${searchResult?.length || 0} matches found.
        `

        yield { type: "finish", result: plan }
    }
}

AgentRegistry.register(PlannerAgent)
export { PlannerAgent }


