/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Parallel Agent Orchestrator for concurrent agent execution.
 * Enables spawning multiple agents in parallel and aggregating their results.
 */

import type { Config } from '../index.ts'
import type { AgentRegistry } from './agent-registry.ts';
import type { MessageBus } from '../index.ts'
import type { AgentDefinition, AgentInputs, OutputObject } from './types.ts';
import { LocalAgentExecutor } from '../tools/local-executor.ts';
import { debugLogger } from 'navi-ai-agent/utils/debugLogger'

/** Configuration for parallel agent execution */
export interface ParallelAgentConfig {
    /** Maximum number of agents to run concurrently */
    maxConcurrency: number;
    /** Timeout for the entire parallel execution in milliseconds */
    timeoutMs: number;
    /** Whether to fail fast on first agent error */
    failFast: boolean;
}

/** Result from a single agent in a parallel execution */
export interface AgentResult {
    agentName: string;
    status: 'fulfilled' | 'rejected';
    output?: OutputObject;
    error?: Error;
    durationMs: number;
}

/** Result from a parallel agent execution */
export interface ParallelExecutionResult {
    results: AgentResult[];
    totalDurationMs: number;
    successCount: number;
    failureCount: number;
}

/** Default configuration for parallel execution */
const DEFAULT_PARALLEL_CONFIG: ParallelAgentConfig = {
    maxConcurrency: 5,
    timeoutMs: 5 * 60 * 1000, // 5 minutes
    failFast: false,
};

/**
 * Orchestrates parallel execution of multiple agents.
 * Manages concurrency, error handling, and result aggregation.
 */
export class ParallelAgentOrchestrator {
    private readonly config: Config;
    private readonly registry: AgentRegistry;
    private readonly parallelConfig: ParallelAgentConfig;

    constructor(
        config: Config,
        registry: AgentRegistry,
        parallelConfig: Partial<ParallelAgentConfig> = {},
    ) {
        this.config = config;
        this.registry = registry;
        this.parallelConfig = { ...DEFAULT_PARALLEL_CONFIG, ...parallelConfig };
    }

    /**
     * Spawns multiple agents in parallel and waits for all to complete.
     * 
     * @param agentTasks Array of agent tasks to execute
     * @param signal AbortSignal for cancellation
     * @returns Aggregated results from all agents
     */
    async spawnParallel(
        agentTasks: Array<{ agentName: string; inputs: AgentInputs }>,
        signal: AbortSignal,
    ): Promise<ParallelExecutionResult> {
        const startTime = Date.now();

        debugLogger.info(`[ParallelAgentOrchestrator] Spawning ${agentTasks.length} agents in parallel`);

        // Create timeout controller
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(
            () => timeoutController.abort(new Error('Parallel execution timed out')),
            this.parallelConfig.timeoutMs,
        );

        const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);

        try {
            // Chunk tasks by max concurrency
            const results: AgentResult[] = [];
            const chunks = this.chunkArray(agentTasks, this.parallelConfig.maxConcurrency);

            for (const chunk of chunks) {
                if (combinedSignal.aborted) break;

                const chunkPromises = chunk.map(task =>
                    this.executeAgent(task.agentName, task.inputs, combinedSignal)
                );

                if (this.parallelConfig.failFast) {
                    // Use Promise.all with early failure
                    const chunkResults = await Promise.all(chunkPromises);
                    results.push(...chunkResults);

                    // Check for failures
                    if (chunkResults.some(r => r.status === 'rejected')) {
                        break;
                    }
                } else {
                    // Use Promise.allSettled for resilient execution
                    const settledResults = await Promise.allSettled(chunkPromises);
                    for (const result of settledResults) {
                        if (result.status === 'fulfilled') {
                            results.push(result.value);
                        } else {
                            results.push({
                                agentName: 'unknown',
                                status: 'rejected',
                                error: result.reason,
                                durationMs: 0,
                            });
                        }
                    }
                }
            }

            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;

            debugLogger.info(`[ParallelAgentOrchestrator] Completed: ${successCount} success, ${failureCount} failed`);

            return {
                results,
                totalDurationMs: Date.now() - startTime,
                successCount,
                failureCount,
            };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Executes a single agent and returns the result with timing.
     */
    private async executeAgent(
        agentName: string,
        inputs: AgentInputs,
        signal: AbortSignal,
    ): Promise<AgentResult> {
        const startTime = Date.now();

        try {
            const definition = this.registry.getDefinition(agentName);
            if (!definition) {
                throw new Error(`Agent '${agentName}' not found in registry`);
            }

            if (definition.kind !== 'local') {
                throw new Error(`Parallel execution only supports local agents. '${agentName}' is remote.`);
            }

            const executor = await LocalAgentExecutor.create(
                definition,
                this.config,
                (activity) => {
                    debugLogger.debug(`[${agentName}] Activity: ${activity.type}`);
                },
            );

            const output = await executor.run(inputs, signal);

            return {
                agentName,
                status: 'fulfilled',
                output,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            return {
                agentName,
                status: 'rejected',
                error: error instanceof Error ? error : new Error(String(error)),
                durationMs: Date.now() - startTime,
            };
        }
    }

    /**
     * Helper to chunk an array into smaller arrays.
     */
    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}

