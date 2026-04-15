import { AgentTemplate } from "../programmatic"

/**
 * DocArchitect Agent
 * Phase: Documentation
 * Responsibility: API docs, tutorials, and system documentation.
 */
export const DocArchitect: AgentTemplate = {
    id: "doc-architect",
    name: "DocArchitect",
    description: "Builds comprehensive system documentation, API references, and user guides",
    tools: ["read", "write"],
    phase: "document",
    skills: ["write-release-notes", "writing-skills", "brainstorming"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Doc Audit", description: "Scanning codebase for missing or outdated documentation" }
        yield { type: "log", message: "Structuring API references and usage examples..." }
        yield { type: "step", name: "Tutorial Creation", description: "Drafting step-by-step guides for common workflows" }
        yield { type: "step", name: "Spec Refinement", description: "Ensuring technical accuracy and clarity across all documents" }
        yield { type: "finish", result: "Comprehensive documentation library initialized and updated." }
    }
}
