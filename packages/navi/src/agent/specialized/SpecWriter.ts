import { AgentTemplate, AgentStep } from "../programmatic"

/**
 * SpecWriter Agent
 * Phase: Analyze
 * Responsibility: Transform user requirements into structured technical specifications.
 */
export const SpecWriter: AgentTemplate = {
    id: "spec-writer",
    name: "SpecWriter",
    description: "Transforms user requirements into technical specifications",
    tools: [],
    phase: "analyze",
    skills: ["analyze-extract-decisions", "analyze-scenario", "analyze-write-section", "writing-plans", "brainstorming"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Requirements Gathering", description: "Analyzing user input for core requirements" }
        yield { type: "log", message: `Analyzing input: ${context.input.slice(0, 100)}...` }
        
        // In a real implementation, this would call an LLM to generate the spec
        yield { type: "step", name: "Architectural Planning", description: "Mapping requirements to technical components" }
        
        yield { type: "step", name: "Output Generation", description: "Producing the final specification document" }
        
        const result = `# Technical Specification\n\n## Overview\n${context.input}\n\n## Requirements\n- Specialized agents architecture\n- Waterfall workflow implementation\n- AST-based generation`
        
        yield { type: "finish", result }
    }
}
