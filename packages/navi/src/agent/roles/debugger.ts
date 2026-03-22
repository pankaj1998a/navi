import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

const DebuggerAgent: AgentTemplate = {
    id: "debugger",
    name: "System Debugger",
    description: "Troubleshoots errors and provides root cause analysis",
    tools: ["read", "write", "edit", "bash", "grep"],
    handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
        yield { type: "step", name: "Diagnosing issue" }

        // 1. Check logs or run a diagnostic command
        yield { type: "log", message: "Running diagnostic checks and looking for error patterns..." }
        const diagnosticResult = yield {
            type: "tool",
            name: "bash",
            input: { command: "npm test" } // Or a specific debug command from context.input
        }

        // 2. Analyze failure
        if (diagnosticResult?.includes("fail") || diagnosticResult?.includes("error")) {
            yield { type: "log", message: "Error detected. Investigating code..." }
            yield {
                type: "tool",
                name: "grep",
                input: { query: "error", path: ["./src"] }
            }
            yield { type: "finish", result: "Root cause identified in test suite. Needs fix in logic." }
        } else {
            yield { type: "finish", result: "No immediate errors found in the main workspace." }
        }
    }
}

AgentRegistry.register(DebuggerAgent)
export { DebuggerAgent }
