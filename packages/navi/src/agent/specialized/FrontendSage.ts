import { AgentTemplate } from "../programmatic"

/**
 * FrontendSage Agent
 * Phase: Design
 * Responsibility: UI/UX, Component Architecture, and Style Systems.
 */
export const FrontendSage: AgentTemplate = {
    id: "frontend-sage",
    name: "FrontendSage",
    description: "Expert in UI/UX, responsive design and frontend frameworks",
    tools: ["read", "write", "edit"],
    phase: "design",
    skills: ["image-describe-draft", "interface-schema-review"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "UI Analysis", description: "Reviewing layout constraints and visual requirements" }
        yield { type: "log", message: "Analyzing aesthetic direction and component hierarchy..." }
        yield { type: "step", name: "Component Architecture", description: "Designing reusable and accessible component structures" }
        yield { type: "step", name: "Styling Strategy", description: "Implementing design tokens and CSS patterns" }
        yield { type: "finish", result: "Frontend design and components standardized." }
    }
}
