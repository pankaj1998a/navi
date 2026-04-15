import z from "zod";
import { Tool } from "./tool";
import { updatePreferences, loadPreferences } from "../config/preferences";
import { Agent } from "../agent/agent";

const parameters = z.object({
    agent_name: z.string().describe("The name of the agent to configure (e.g., 'build', 'reviewer', 'general')"),
    model_id: z.string().describe("The full model identifier (e.g., 'anthropic/claude-3-7-sonnet', 'openai/o1')")
});

export const ListSubAgentsTool = Tool.define("list_subagents", {
    description: "List all registered sub-agents and their current model assignments.",
    parameters: z.object({}),
    async execute() {
        const agents = await Agent.list();
        const currentPrefs = loadPreferences();
        
        const list = agents.map(a => {
            const override = currentPrefs.agentModels?.[a.name];
            return {
                name: a.name,
                description: a.description,
                current_model: override || a.model || "default",
                is_override: !!override
            };
        });

        return {
            title: "Sub-Agents List",
            metadata: { count: list.length },
            output: JSON.stringify(list, null, 2)
        };
    }
});

export const ListAvailableModelsTool = Tool.define("list_available_models", {
    description: "List all available providers and their supported models.",
    parameters: z.object({
        provider_id: z.string().optional().describe("Filter by provider (e.g., 'anthropic', 'openai', 'google', 'deepseek')")
    }),
    async execute(params) {
        const { Provider } = await import("../provider/provider");
        const providers = await Provider.list();
        const providersArray = Object.values(providers);
        
        let result = providersArray;
        if (params.provider_id) {
            result = providersArray.filter((p: any) => p.id === params.provider_id);
        }

        const formatted = result.map((p: any) => ({
            provider: p.id,
            models: Object.values(p.models || {}).map((m: any) => m.id)
        }));

        return {
            title: "Available Models",
            metadata: { provider: params.provider_id || "all" },
            output: JSON.stringify(formatted, null, 2)
        };
    }
});

export const ConfigureAgentModelTool = Tool.define("configure_agent_model", {
    description: "Permanently update the model assigned to a specific sub-agent. This change takes immediate effect.",
    parameters,
    async execute(params, ctx) {
        const agents = await Agent.list();
        const targetAgent = agents.find(a => a.name === params.agent_name);
        
        if (!targetAgent) {
            return {
                title: "Config Error",
                metadata: { 
                    error: "Agent not found",
                    agent: params.agent_name,
                    model: params.model_id
                },
                output: `Error: Agent '${params.agent_name}' not found.`
            };
        }

        const currentPrefs = loadPreferences();
        const agentModels = { ...currentPrefs.agentModels, [params.agent_name]: params.model_id };
        
        updatePreferences({ agentModels });

        return {
            title: "Model Configured",
            metadata: { 
                error: "",
                agent: params.agent_name, 
                model: params.model_id 
            },
            output: `Successfully updated agent '${params.agent_name}' to use model '${params.model_id}'.`
        };
    }
});
