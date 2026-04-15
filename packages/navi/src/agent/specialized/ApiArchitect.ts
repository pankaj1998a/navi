import { AgentTemplate } from "../programmatic"

/**
 * ApiArchitect Agent
 * Phase: Interface
 * Responsibility: API design, endpoint structure, and integration mapping.
 */
export const ApiArchitect: AgentTemplate = {
    id: "api-architect",
    name: "ApiArchitect",
    description: "Expert in designing robust APIs and service interfaces",
    tools: ["read", "write", "edit"],
    phase: "interface",
    skills: ["interface-action-endpoint-write", "interface-base-endpoint-write", "interface-group", "interface-operation", "interface-schema", "interface-schema-refine", "preliminary-interface-operation"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Interface Mapping", description: "Defining request/response schemas and endpoints" }
        yield { type: "log", message: "Ensuring RESTful principles and type safety across services..." }
        yield { type: "step", name: "Protocol Design", description: "Mapping data flows between frontend and backend" }
        yield { type: "step", name: "Mock Generation", description: "Creating interactive API mocks for rapid prototyping" }
        yield { type: "finish", result: "API architecture and interface contracts established." }
    }
}
