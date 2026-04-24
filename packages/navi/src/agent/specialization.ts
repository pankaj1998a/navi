/**
 * Agent Specialization Framework
 * 
 * Implements specialized agents with clear responsibilities
 * and declarative agent definitions.
 */

import { Log } from '../util/log'
import { z } from 'zod'

const log = Log.create({ service: 'agent-specialization' })

export const AgentDefinitionSchema = z.object({
    id: z.string().min(1),
    publisher: z.string().default('navi'),
    model: z.string().optional(),
    displayName: z.string(),
    spawnerPrompt: z.string(),
    inputSchema: z.record(z.string(), z.object({
        type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
        description: z.string(),
        properties: z.record(z.string(), z.object({
            type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
            description: z.string(),
            required: z.boolean().optional()
        })).optional()
    })).optional(),
    outputMode: z.enum(['last_message', 'all_messages', 'tool_output']).default('last_message'),
    includeMessageHistory: z.boolean().default(true),
    toolNames: z.array(z.string()),
    systemPrompt: z.string(),
    instructionsPrompt: z.string(),
    handleSteps: z.function().optional()
})

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

export const SPECIALIZED_AGENTS: Record<string, AgentDefinition> = {
    filePicker: {
        id: 'file-picker',
        publisher: 'navi',
        displayName: 'File Picker Agent',
        spawnerPrompt: 'Scans codebase to understand architecture and find relevant files for a task.',
        toolNames: ['glob', 'grep', 'read', 'list'],
        systemPrompt: `You are an expert at analyzing codebase structure and finding relevant files.
    
Your job is to:
1. Understand the project structure
2. Identify relevant files based on the task
3. Provide a prioritized list of files to modify`,
        inputSchema: {
            task: {
                type: 'string',
                description: 'The task to find files for'
            }
        },
        outputMode: 'last_message',
        includeMessageHistory: false,
        instructionsPrompt: `Find all files relevant to the task: {task}
    
Provide a JSON array of file paths sorted by relevance.`,
    },

    planner: {
        id: 'planner',
        publisher: 'navi',
        displayName: 'Planner Agent',
        spawnerPrompt: 'Creates detailed implementation plans for coding tasks.',
        toolNames: ['read', 'grep', 'glob'],
        systemPrompt: `You are an expert software architect who creates detailed implementation plans.`,
        inputSchema: {
            task: {
                type: 'string',
                description: 'The task to plan'
            },
            files: {
                type: 'array',
                description: 'Relevant files to consider'
            }
        },
        outputMode: 'last_message',
        includeMessageHistory: true,
        instructionsPrompt: `Create a detailed implementation plan for: {task}
    
Consider these files:
{files}
    
Output a JSON plan with phases and dependencies.`,
    },

    editor: {
        id: 'editor',
        publisher: 'navi',
        displayName: 'Editor Agent',
        spawnerPrompt: 'Makes precise code edits based on requirements.',
        toolNames: ['read', 'write', 'edit', 'bash'],
        systemPrompt: `You are an expert code editor who makes precise, targeted changes.`,
        inputSchema: {
            file: {
                type: 'string',
                description: 'File to edit'
            },
            changes: {
                type: 'string',
                description: 'Description of changes needed'
            }
        },
        outputMode: 'last_message',
        includeMessageHistory: true,
        instructionsPrompt: `Make the following changes to {file}:
    
{changes}`,
    }
}

export function createAgentDefinition(agent: Partial<AgentDefinition>): AgentDefinition {
    const result: AgentDefinition = {
        id: agent.id || 'custom-agent',
        publisher: agent.publisher || 'navi',
        model: agent.model,
        displayName: agent.displayName || 'Custom Agent',
        spawnerPrompt: agent.spawnerPrompt || 'Custom agent for specific tasks',
        toolNames: agent.toolNames || ['read', 'write'],
        outputMode: agent.outputMode || 'last_message',
        includeMessageHistory: agent.includeMessageHistory ?? true,
        systemPrompt: agent.systemPrompt || 'You are a helpful AI assistant.',
        instructionsPrompt: agent.instructionsPrompt || 'Complete the assigned task.',
        ...agent
    }

    return AgentDefinitionSchema.parse(result)
}

export function getSpecializedAgent(agentId: string): AgentDefinition | undefined {
    return SPECIALIZED_AGENTS[agentId]
}

export function listSpecializedAgents(): string[] {
    return Object.keys(SPECIALIZED_AGENTS)
}

export class SpecializedAgentRunner {
    private agent: AgentDefinition

    constructor(agentId: string | AgentDefinition) {
        if (typeof agentId === 'string') {
            const found = getSpecializedAgent(agentId)
            if (!found) {
                throw new Error(`Unknown agent: ${agentId}`)
            }
            this.agent = found
        } else {
            this.agent = createAgentDefinition(agentId)
        }
    }

    async run(input: Record<string, any>): Promise<any> {
        log.info(`Running specialized agent: ${this.agent.id}`)

        // In a real implementation, this would spawn an agent using AgentSpawner
        return { agent: this.agent.id, status: 'simulated', input }
    }

    getDefinition(): AgentDefinition {
        return this.agent
    }
}

export default {
    AgentDefinitionSchema,
    SPECIALIZED_AGENTS,
    createAgentDefinition,
    getSpecializedAgent,
    listSpecializedAgents,
    SpecializedAgentRunner
}


