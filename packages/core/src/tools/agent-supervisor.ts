/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Agent Supervisor - monitors and controls agent lifecycle.
 * 
 * Provides:
 * - Agent health monitoring
 * - Failure detection and recovery
 * - Auto-restart on recoverable errors
 * - Resource cleanup
 */

import type { Config } from '../index.ts'
import type { AgentRegistry } from './registry.ts';
import type { AgentInputs, OutputObject } from './types.ts';
import { LocalAgentExecutor } from './local-executor.ts';
import { AgentMemory } from './agent-memory.ts';
import { debugLogger } from 'navi-ai-agent/utils/debugLogger'

/** Agent status */
export enum AgentStatus {
    PENDING = 'pending',
    RUNNING = 'running',
    COMPLETED = 'completed',
    FAILED = 'failed',
    RESTARTING = 'restarting',
    STOPPED = 'stopped',
}

/** Supervised agent instance */
export interface SupervisedAgent {
    id: string;
    agentName: string;
    status: AgentStatus;
    startTime: number;
    endTime?: number;
    inputs: AgentInputs;
    output?: OutputObject;
    error?: Error;
    restartCount: number;
    abortController: AbortController;
}

/** Supervisor configuration */
export interface SupervisorConfig {
    maxRestarts: number;
    restartDelayMs: number;
    healthCheckIntervalMs: number;
    maxConcurrentAgents: number;
}

const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
    maxRestarts: 3,
    restartDelayMs: 1000,
    healthCheckIntervalMs: 5000,
    maxConcurrentAgents: 10,
};

/**
 * Agent Supervisor - manages agent lifecycle and recovery.
 */
export class AgentSupervisor {
    private readonly config: Config;
    private readonly registry: AgentRegistry;
    private readonly supervisorConfig: SupervisorConfig;
    private readonly agents = new Map<string, SupervisedAgent>();
    private readonly memory = AgentMemory.getInstance();
    private healthCheckInterval?: ReturnType<typeof setInterval>;

    constructor(
        config: Config,
        registry: AgentRegistry,
        supervisorConfig: Partial<SupervisorConfig> = {},
    ) {
        this.config = config;
        this.registry = registry;
        this.supervisorConfig = { ...DEFAULT_SUPERVISOR_CONFIG, ...supervisorConfig };
    }

    /**
     * Spawns a new supervised agent.
     */
    async spawn(
        agentName: string,
        inputs: AgentInputs,
        signal?: AbortSignal,
    ): Promise<string> {
        const id = `${agentName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const abortController = new AbortController();

        // Link external signal if provided
        if (signal) {
            signal.addEventListener('abort', () => {
                abortController.abort(signal.reason);
            });
        }

        const supervised: SupervisedAgent = {
            id,
            agentName,
            status: AgentStatus.PENDING,
            startTime: Date.now(),
            inputs,
            restartCount: 0,
            abortController,
        };

        this.agents.set(id, supervised);
        this.memory.set(`agent_${id}_status`, AgentStatus.PENDING, 'supervisor');

        debugLogger.log(`[AgentSupervisor] Spawned agent ${id}`);

        // Start execution asynchronously
        this.executeAgent(supervised).catch(error => {
            debugLogger.error(`[AgentSupervisor] Agent ${id} failed: ${error}`);
        });

        return id;
    }

    /**
     * Executes an agent with supervision.
     */
    private async executeAgent(supervised: SupervisedAgent): Promise<void> {
        const { id, agentName, inputs, abortController } = supervised;

        try {
            supervised.status = AgentStatus.RUNNING;
            this.memory.set(`agent_${id}_status`, AgentStatus.RUNNING, 'supervisor');

            const definition = this.registry.getDefinition(agentName);
            if (!definition) {
                throw new Error(`Agent '${agentName}' not found in registry`);
            }

            if (definition.kind !== 'local') {
                throw new Error(`Supervisor only supports local agents. '${agentName}' is remote.`);
            }

            const executor = await LocalAgentExecutor.create(
                definition,
                this.config,
                (activity) => {
                    debugLogger.debug(`[${id}] Activity: ${activity.type}`);
                },
            );

            const output = await executor.run(inputs, abortController.signal);

            supervised.status = AgentStatus.COMPLETED;
            supervised.output = output;
            supervised.endTime = Date.now();
            this.memory.set(`agent_${id}_status`, AgentStatus.COMPLETED, 'supervisor');
            this.memory.set(`agent_${id}_result`, output, 'supervisor');

            debugLogger.log(`[AgentSupervisor] Agent ${id} completed`);
        } catch (error) {
            supervised.status = AgentStatus.FAILED;
            supervised.error = error instanceof Error ? error : new Error(String(error));
            supervised.endTime = Date.now();
            this.memory.set(`agent_${id}_status`, AgentStatus.FAILED, 'supervisor');

            debugLogger.error(`[AgentSupervisor] Agent ${id} failed: ${error}`);

            // Attempt restart if within limits
            if (supervised.restartCount < this.supervisorConfig.maxRestarts) {
                await this.restart(id);
            }
        }
    }

    /**
     * Stops a running agent.
     */
    stop(id: string): boolean {
        const supervised = this.agents.get(id);
        if (!supervised) {
            debugLogger.warn(`[AgentSupervisor] Agent ${id} not found`);
            return false;
        }

        if (supervised.status !== AgentStatus.RUNNING) {
            debugLogger.warn(`[AgentSupervisor] Agent ${id} is not running`);
            return false;
        }

        supervised.abortController.abort(new Error('Stopped by supervisor'));
        supervised.status = AgentStatus.STOPPED;
        supervised.endTime = Date.now();
        this.memory.set(`agent_${id}_status`, AgentStatus.STOPPED, 'supervisor');

        debugLogger.log(`[AgentSupervisor] Stopped agent ${id}`);
        return true;
    }

    /**
     * Restarts a failed or stopped agent.
     */
    async restart(id: string): Promise<boolean> {
        const supervised = this.agents.get(id);
        if (!supervised) {
            debugLogger.warn(`[AgentSupervisor] Agent ${id} not found`);
            return false;
        }

        if (supervised.restartCount >= this.supervisorConfig.maxRestarts) {
            debugLogger.warn(`[AgentSupervisor] Agent ${id} exceeded max restarts`);
            return false;
        }

        supervised.status = AgentStatus.RESTARTING;
        supervised.restartCount += 1;
        supervised.abortController = new AbortController();
        this.memory.set(`agent_${id}_status`, AgentStatus.RESTARTING, 'supervisor');

        debugLogger.log(`[AgentSupervisor] Restarting agent ${id} (attempt ${supervised.restartCount})`);

        // Delay before restart
        await new Promise(resolve => setTimeout(resolve, this.supervisorConfig.restartDelayMs));

        // Re-execute
        this.executeAgent(supervised).catch(error => {
            debugLogger.error(`[AgentSupervisor] Agent ${id} restart failed: ${error}`);
        });

        return true;
    }

    /**
     * Gets the status of an agent.
     */
    getStatus(id: string): SupervisedAgent | undefined {
        return this.agents.get(id);
    }

    /**
     * Gets all supervised agents.
     */
    getAllAgents(): SupervisedAgent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Gets running agents count.
     */
    getRunningCount(): number {
        return Array.from(this.agents.values()).filter(
            a => a.status === AgentStatus.RUNNING
        ).length;
    }

    /**
     * Waits for an agent to complete.
     */
    async waitFor(id: string, timeoutMs = 60000): Promise<OutputObject | undefined> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const supervised = this.agents.get(id);
            if (!supervised) return undefined;

            if (supervised.status === AgentStatus.COMPLETED) {
                return supervised.output;
            }

            if (supervised.status === AgentStatus.FAILED ||
                supervised.status === AgentStatus.STOPPED) {
                return undefined;
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return undefined;
    }

    /**
     * Starts health check monitoring.
     */
    startHealthCheck(): void {
        if (this.healthCheckInterval) return;

        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, this.supervisorConfig.healthCheckIntervalMs);
    }

    /**
     * Stops health check monitoring.
     */
    stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }
    }

    /**
     * Performs health check on all running agents.
     */
    private performHealthCheck(): void {
        const now = Date.now();
        for (const supervised of this.agents.values()) {
            if (supervised.status === AgentStatus.RUNNING) {
                const runtime = now - supervised.startTime;
                const maxRuntime = 15 * 60 * 1000; // 15 minutes

                if (runtime > maxRuntime) {
                    debugLogger.warn(`[AgentSupervisor] Agent ${supervised.id} exceeded max runtime`);
                    this.stop(supervised.id);
                }
            }
        }
    }

    /**
     * Cleans up completed/failed agents older than specified age.
     */
    cleanup(maxAgeMs = 30 * 60 * 1000): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [id, supervised] of this.agents) {
            if (
                supervised.endTime &&
                now - supervised.endTime > maxAgeMs &&
                (supervised.status === AgentStatus.COMPLETED ||
                    supervised.status === AgentStatus.FAILED ||
                    supervised.status === AgentStatus.STOPPED)
            ) {
                this.agents.delete(id);
                this.memory.delete(`agent_${id}_status`);
                this.memory.delete(`agent_${id}_result`);
                cleaned += 1;
            }
        }

        debugLogger.log(`[AgentSupervisor] Cleaned up ${cleaned} agents`);
        return cleaned;
    }

    /**
     * Stops all running agents and cleans up.
     */
    dispose(): void {
        this.stopHealthCheck();

        for (const supervised of this.agents.values()) {
            if (supervised.status === AgentStatus.RUNNING) {
                supervised.abortController.abort(new Error('Supervisor disposed'));
            }
        }

        this.agents.clear();
        debugLogger.log('[AgentSupervisor] Disposed');
    }
}

