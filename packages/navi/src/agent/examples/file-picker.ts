import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

const FilePickerAgent: AgentTemplate = {
    id: "file-picker",
    name: "File Picker",
    description: "Intelligently selects files based on user query",
    tools: ["grep", "read", "write", "edit", "bash"],
    handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
        yield { type: "step", name: "Understanding query" }

        // 1. Search for potential files
        const searchResult = yield {
            type: "tool",
            name: "grep",
            input: { query: context.input }
        }

        // 2. Select best matches using LLM (simulated here)
        yield { type: "log", message: `Found ${searchResult?.length || 0} potentially relevant files.` }

        // 3. Return the best file
        if (searchResult && searchResult.length > 0) {
            yield { type: "finish", result: searchResult[0] }
        } else {
            yield { type: "finish", result: "No files found" }
        }
    }
}

AgentRegistry.register(FilePickerAgent)
export { FilePickerAgent }
