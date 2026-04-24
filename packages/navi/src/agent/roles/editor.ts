import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

const EditorAgent: AgentTemplate = {
    id: "editor",
    name: "Code Editor",
    description: "Specialized in making precise code modifications",
    phase: "realize",
    skills: ["editing"],
    tools: ["read", "write", "edit", "patch", "bash"],
    handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
        yield { type: "step", name: "Applying changes" }

        // 1. Read target files
        yield { type: "log", message: "reading target files..." }

        // 2. Perform edits (simulated tool calls)
        const result = yield {
            type: "tool",
            name: "write",
            input: { filePath: "changes_log.md", content: `Applied changes for: ${context.input}` }
        }

        yield { type: "finish", result: `Successfully applied changes. Result: ${JSON.stringify(result)}` }
    }
}

AgentRegistry.register(EditorAgent)
export { EditorAgent }


