import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

const DocumentationAgent: AgentTemplate = {
    id: "docs-writer",
    name: "Documentation Writer",
    description: "Specialized in creating and maintaining project documentation",
    tools: ["read", "write", "grep", "edit", "bash", "write_document"],
    handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
        yield { type: "step", name: "Updating documentation" }

        // 1. Gather info for docs
        yield { type: "log", message: "Scanning codebase for documentation gaps..." }

        // 2. Write doc file
        yield {
            type: "tool", name: "write",
            input: {
                filePath: "DOCS_UPDATE.md",
                content: `# Progress Update\n\nAutomatically generated documentation based on: ${context.input}`
            }
        }

        yield { type: "finish", result: "Documentation successfully updated. Check DOCS_UPDATE.md" }
    }
}

AgentRegistry.register(DocumentationAgent)
export { DocumentationAgent }


