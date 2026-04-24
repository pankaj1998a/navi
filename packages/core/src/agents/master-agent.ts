/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Master Agent Orchestrator - intelligent task delegation and agent management.
 * 
 * The Master Agent is a supervisory agent that:
 * - Analyzes user input to understand task requirements
 * - Selects appropriate sub-agents based on task complexity
 * - Manages model allocation based on availability
 * - Controls agent lifecycle (start, stop, restart)
 * - Coordinates parallel execution of multiple agents
 */

import { z } from 'zod';
import type { Config } from '../index.ts'
import type { AgentRegistry } from './agent-registry.ts';
import type { LocalAgentDefinition, AgentInputs, OutputObject } from './types.ts';
import { ParallelAgentOrchestrator } from './parallel-agent-orchestrator.ts';
import { AgentMemory } from './agent-memory.ts';
import { debugLogger } from '../util/debugLogger.ts';
import { DELEGATE_TO_AGENT_TOOL_NAME } from '../tools/tool-names.ts';

/** Schema for Master Agent output */
const MasterAgentOutputSchema = z.object({
    summary: z.string().describe('Summary of orchestration results'),
    agents_used: z.array(z.string()).describe('List of agents that were invoked'),
    success: z.boolean().describe('Whether the overall task was successful'),
    details: z.record(z.string(), z.unknown()).optional().describe('Detailed results from each agent'),
});

/** Task complexity levels for model selection */
export enum TaskComplexity {
    SIMPLE = 'simple',
    MODERATE = 'moderate',
    COMPLEX = 'complex',
}

/** Agent capability categories */
export interface AgentCapability {
    name: string;
    description: string;
    complexity: TaskComplexity;
    keywords: string[];
}

/** Task analysis result */
export interface TaskAnalysis {
    complexity: TaskComplexity;
    suggestedAgents: string[];
    parallel: boolean;
    rationale: string;
}

/**
 * Master Agent Definition Factory
 * Creates a supervisory agent that orchestrates other agents.
 */
export const MasterAgent = (
    config: Config,
    registry: AgentRegistry,
): LocalAgentDefinition<typeof MasterAgentOutputSchema> => ({
    kind: 'local',
    name: 'master',
    displayName: 'Master Agent',
    description:
        'A supervisory agent that analyzes tasks, selects appropriate sub-agents, manages model allocation, and coordinates parallel execution. Use for complex multi-step tasks.',
    experimental: false,
    inputConfig: {
        inputs: {
            task: {
                description: 'The user task or request to be orchestrated across agents.',
                type: 'string',
                required: true,
            },
            max_agents: {
                description: 'Maximum number of agents to spawn in parallel (default: 5).',
                type: 'integer',
                required: false,
            },
            retry_on_failure: {
                description: 'Whether to retry failed agents with different models.',
                type: 'boolean',
                required: false,
            },
        },
    },
    outputConfig: {
        outputName: 'result',
        description: 'Orchestration results including agent outputs and status.',
        schema: MasterAgentOutputSchema,
    },
    modelConfig: {
        model: 'auto', // Use best available model for orchestration
    },
    get toolConfig() {
        // Master agent has access to delegation and parallel spawning tools
        const tools = [
            DELEGATE_TO_AGENT_TOOL_NAME,
            'spawn_parallel_agents',
            'read_file',
            'write_file',
            'list_directory',
        ];
        return { tools };
    },
    get promptConfig() {
        const availableAgents = registry.getAllDefinitions()
            .filter(d => d.name !== 'master') // Exclude self
            .map(d => `- **${d.name}**: ${d.description}`)
            .join('\n');

        return {
            systemPrompt: `You are the Master Agent, a supervisory AI that orchestrates other specialized agents.

## Your Responsibilities
1. **Task Analysis**: Understand user requests and break them into sub-tasks
2. **Agent Selection**: Choose the best agent(s) for each sub-task
3. **Parallel Execution**: Spawn multiple agents when tasks are independent
4. **Error Recovery**: Retry failed agents with different strategies
5. **Result Aggregation**: Combine outputs from multiple agents

## Available Agents
${availableAgents}

## Decision Guidelines
- For simple tasks: delegate to a single agent
- For complex tasks: break into parallel sub-tasks
- For code investigation: use codebase_investigator
- For general tasks: use generalist
- For CLI operations: use cli_help

## Memory Coordination
Use shared memory to coordinate between agents:
- Store intermediate results with keys like "task_<id>_result"
- Check for existing results before re-running agents

## Error Handling
If an agent fails:
1. Log the failure
2. Try with a different model if available
3. Delegate to generalist as fallback

Always complete your task by calling complete_task with a summary.`,
            query: '${task}',
        };
    },
    runConfig: {
        maxTimeMinutes: 15,
        maxTurns: 30,
    },
    processOutput: (output) => {
        return `## Master Agent Results

**Success**: ${output.success ? '✅' : '❌'}

### Agents Used
${output.agents_used.map(a => `- ${a}`).join('\n')}

### Summary
${output.summary}
`;
    },
});

/**
 * Task Router - analyzes tasks and routes to appropriate agents.
 */
export class TaskRouter {
    private readonly registry: AgentRegistry;
    private readonly capabilities: AgentCapability[];

    constructor(registry: AgentRegistry) {
        this.registry = registry;
        this.capabilities = this.buildCapabilityMap();
    }

    /**
     * Analyzes a task and determines the best execution strategy.
     */
    analyzeTask(task: string): TaskAnalysis {
        const complexity = this.assessComplexity(task);
        const suggestedAgents = this.matchAgents(task);
        const parallel = suggestedAgents.length > 1 && this.canParallelize(task);

        return {
            complexity,
            suggestedAgents,
            parallel,
            rationale: this.generateRationale(task, suggestedAgents, parallel),
        };
    }

    /**
     * Assesses task complexity based on keywords and structure.
     */
    private assessComplexity(task: string): TaskComplexity {
        const lowerTask = task.toLowerCase();

        // Complex indicators
        if (
            lowerTask.includes('refactor') ||
            lowerTask.includes('implement') ||
            lowerTask.includes('create') && lowerTask.includes('system') ||
            lowerTask.includes('multiple') ||
            lowerTask.includes('parallel') ||
            task.length > 500
        ) {
            return TaskComplexity.COMPLEX;
        }

        // Simple indicators
        if (
            lowerTask.includes('explain') ||
            lowerTask.includes('what is') ||
            lowerTask.includes('how to') ||
            task.length < 100
        ) {
            return TaskComplexity.SIMPLE;
        }

        return TaskComplexity.MODERATE;
    }

    /**
     * Matches task to available agents based on keywords.
     */
    private matchAgents(task: string): string[] {
        const lowerTask = task.toLowerCase();
        const matches: Array<{ name: string; score: number }> = [];

        for (const cap of this.capabilities) {
            let score = 0;
            for (const keyword of cap.keywords) {
                if (lowerTask.includes(keyword)) {
                    score += 1;
                }
            }
            if (score > 0) {
                matches.push({ name: cap.name, score });
            }
        }

        // Sort by score and return top 3
        return matches
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(m => m.name);
    }

    /**
     * Determines if task parts can be executed in parallel.
     */
    private canParallelize(task: string): boolean {
        const lowerTask = task.toLowerCase();
        // Look for parallel-friendly patterns
        return (
            lowerTask.includes(' and ') ||
            lowerTask.includes('multiple') ||
            lowerTask.includes('all ') ||
            lowerTask.includes('each ')
        );
    }

    /**
     * Generates explanation for routing decision.
     */
    private generateRationale(
        task: string,
        agents: string[],
        parallel: boolean,
    ): string {
        if (agents.length === 0) {
            return 'No specific agent matched; using generalist.';
        }
        if (parallel) {
            return `Task can be parallelized across: ${agents.join(', ')}`;
        }
        return `Best matched agent: ${agents[0]}`;
    }

    /**
     * Builds capability map from registered agents.
     */
    private buildCapabilityMap(): AgentCapability[] {
        const definitions = this.registry.getAllDefinitions();
        return definitions.map(def => ({
            name: def.name,
            description: def.description,
            complexity: this.inferComplexity(def),
            keywords: this.extractKeywords(def.description),
        }));
    }

    /**
     * Infers complexity from agent definition.
     */
    private inferComplexity(def: { name: string }): TaskComplexity {
        if (def.name.includes('investigator') || def.name.includes('generalist')) {
            return TaskComplexity.COMPLEX;
        }
        return TaskComplexity.MODERATE;
    }

    /**
     * Extracts keywords from description.
     */
    private extractKeywords(description: string): string[] {
        const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'for', 'to', 'and', 'or', 'it']);
        return description
            .toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 3 && !stopWords.has(word))
            .slice(0, 10);
    }
}

/**
 * Model Manager - handles model selection and allocation.
 */
export class ModelManager {
    private readonly config: Config;
    private readonly modelUsage = new Map<string, number>();

    constructor(config: Config) {
        this.config = config;
    }

    /**
     * Selects an appropriate model for a task based on complexity and availability.
     */
    selectModel(complexity: TaskComplexity): string {
        // Model selection strategy based on complexity
        switch (complexity) {
            case TaskComplexity.SIMPLE:
                return 'gemini-2.0-flash-lite'; // Fast, efficient
            case TaskComplexity.MODERATE:
                return 'gemini-2.0-flash'; // Balanced
            case TaskComplexity.COMPLEX:
                return 'gemini-2.5-pro'; // Most capable
            default:
                return 'auto';
        }
    }

    /**
     * Records model usage for load balancing.
     */
    recordUsage(model: string): void {
        const current = this.modelUsage.get(model) ?? 0;
        this.modelUsage.set(model, current + 1);
    }

    /**
     * Gets alternative model if primary is overloaded.
     */
    getAlternative(model: string): string {
        const usage = this.modelUsage.get(model) ?? 0;
        if (usage > 5) {
            // If model is heavily used, try alternatives
            debugLogger.log(`[ModelManager] Model ${model} heavily used, suggesting alternative`);
            return 'auto';
        }
        return model;
    }
}

