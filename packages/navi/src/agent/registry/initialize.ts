import { Registry, AgentDefinition } from "./index"
import * as SpecializedAgents from "../specialized"
import { AgentTemplate } from "../programmatic"

/**
 * Maps a programmatic AgentTemplate to a Registry AgentDefinition
 */
function mapTemplateToDefinition(template: AgentTemplate): AgentDefinition {
    return {
        id: template.id,
        displayName: template.name,
        description: template.description,
        model: template.model || "Navi/big-pickle",
        toolNames: template.tools || [],
        instructionsPrompt: template.systemPrompt || (
            `You are the ${template.name} agent. Your phase is ${template.phase}.` +
            (template.skills.length > 0 ? `\n\nYou possess the following specialized skills: ${template.skills.join(", ")}.` : "")
        ),
        handleSteps: template.handleSteps,
        version: "1.0.0",
        publisher: "system",
        categories: [template.phase, ...template.skills],
        hidden: false,
    }
}

/**
 * Registers all specialized system agents into the registry
 */
export function initializeSystemAgents() {
    const agents = [
        SpecializedAgents.SpecWriter,
        SpecializedAgents.DatabaseDoctor,
        SpecializedAgents.ApiArchitect,
        SpecializedAgents.TestEngineer,
        SpecializedAgents.FrontendSage,
        SpecializedAgents.SecuritySentinel,
        SpecializedAgents.DevOpsDynamo,
        SpecializedAgents.PerformancePilot,
        SpecializedAgents.BugBuster,
        SpecializedAgents.DocArchitect,
    ]

    for (const template of agents) {
        Registry.registerStatic(mapTemplateToDefinition(template))
    }
}
