/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Tool for spawning multiple agents in parallel.
 * Enables 10x agent power by allowing concurrent agent execution.
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
    BaseDeclarativeTool,
    Kind,
    type ToolInvocation,
    type ToolResult,
    BaseToolInvocation,
} from '../index.ts'
import type { AnsiOutput } from '../index.ts'
import type { AgentRegistry } from './registry.ts';
import type { Config } from '../index.ts'
import type { MessageBus } from '../index.ts'
import { ParallelAgentOrchestrator, type ParallelExecutionResult } from './parallel-agent-orchestrator.ts';

const SPAWN_AGENTS_TOOL_NAME = 'spawn_parallel_agents';

/** Schema for the spawn_agents tool */
const SpawnAgentsSchema = z.object({
    agents: z.array(z.object({
        agent_name: z.string().describe('Name of the agent to spawn'),
        inputs: z.record(z.unknown()).describe('Input parameters for the agent'),
    })).min(1).max(10).describe('List of agents to spawn in parallel (max 10)'),
    fail_fast: z.boolean().optional().default(false).describe('Stop execution on first failure'),
});

type SpawnAgentsParams = z.infer<typeof SpawnAgentsSchema>;

export class SpawnAgentsTool extends BaseDeclarativeTool<
    SpawnAgentsParams,
    ToolResult
> {
    constructor(
        private readonly registry: AgentRegistry,
        private readonly config: Config,
        messageBus: MessageBus,
    ) {
        const allAgentNames = registry.getAllAgentNames();
        const description = `Spawn multiple agents in parallel for concurrent execution. Available agents: ${allAgentNames.join(', ')}. 
This tool enables 10x agent power by running up to 10 agents simultaneously. Use this when tasks can be parallelized or when you need multiple perspectives.`;

        super(
            SPAWN_AGENTS_TOOL_NAME,
            'Spawn Parallel Agents',
            description,
            Kind.Think,
            zodToJsonSchema(SpawnAgentsSchema),
            messageBus,
      /* isOutputMarkdown */ true,
      /* canUpdateOutput */ true,
        );
    }

    protected createInvocation(
        params: SpawnAgentsParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ): ToolInvocation<SpawnAgentsParams, ToolResult> {
        return new SpawnAgentsInvocation(
            params,
            this.registry,
            this.config,
            messageBus,
            _toolName,
            _toolDisplayName,
        );
    }
}

class SpawnAgentsInvocation extends BaseToolInvocation<
    SpawnAgentsParams,
    ToolResult
> {
    constructor(
        params: SpawnAgentsParams,
        private readonly registry: AgentRegistry,
        private readonly config: Config,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ) {
        super(
            params,
            messageBus,
            _toolName ?? SPAWN_AGENTS_TOOL_NAME,
            _toolDisplayName,
        );
    }

    getDescription(): string {
        const agentNames = this.params.agents.map(a => a.agent_name).join(', ');
        return `Spawning ${this.params.agents.length} agents in parallel: ${agentNames}`;
    }

    async execute(
        signal: AbortSignal,
        updateOutput?: (output: string | AnsiOutput) => void,
    ): Promise<ToolResult> {
        const orchestrator = new ParallelAgentOrchestrator(
            this.config,
            this.registry,
            { failFast: this.params.fail_fast ?? false },
        );

        if (updateOutput) {
            updateOutput(`🚀 Spawning ${this.params.agents.length} agents in parallel...\n`);
        }

        const agentTasks = this.params.agents.map(a => ({
            agentName: a.agent_name,
            inputs: a.inputs as Record<string, unknown>,
        }));

        const result = await orchestrator.spawnParallel(agentTasks, signal);

        return this.formatResult(result, updateOutput);
    }

    private formatResult(
        result: ParallelExecutionResult,
        updateOutput?: (output: string | AnsiOutput) => void,
    ): ToolResult {
        const lines: string[] = [
            `# Parallel Agent Execution Complete`,
            ``,
            `**Duration:** ${(result.totalDurationMs / 1000).toFixed(2)}s`,
            `**Success:** ${result.successCount} | **Failed:** ${result.failureCount}`,
            ``,
            `## Results`,
        ];

        for (const agentResult of result.results) {
            if (agentResult.status === 'fulfilled' && agentResult.output) {
                lines.push(`### ✅ ${agentResult.agentName} (${(agentResult.durationMs / 1000).toFixed(2)}s)`);
                lines.push(`**Status:** ${agentResult.output.terminate_reason}`);
                lines.push(`**Result:**`);
                lines.push(agentResult.output.result);
                lines.push(``);
            } else {
                lines.push(`### ❌ ${agentResult.agentName} (${(agentResult.durationMs / 1000).toFixed(2)}s)`);
                lines.push(`**Error:** ${agentResult.error?.message ?? 'Unknown error'}`);
                lines.push(``);
            }
        }

        const displayContent = lines.join('\n');

        if (updateOutput) {
            updateOutput(displayContent);
        }

        return {
            llmContent: [{ text: displayContent }],
            returnDisplay: displayContent,
        };
    }
}

