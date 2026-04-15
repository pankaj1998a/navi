/**
 * Navi Swarm System
 *
 * Compatibility layer — all functionality lives in AgentSystem.
 * Use AgentSystem directly for new code.
 */

import { AgentSystem } from "./agent-system"

// Re-export AgentSystem types under Swarm names for backward compatibility
export const Swarm = AgentSystem.Batch
export type Swarm = AgentSystem.Batch

export const createSwarmTask = AgentSystem.createTask
export const createSwarm = AgentSystem.createBatch
export const executeSwarm = AgentSystem.execute
export const cancelSwarm = AgentSystem.cancelBatch
export const getSwarm = AgentSystem.getBatch
export const listSwarms = AgentSystem.listBatches
export const clearCompletedSwarms = AgentSystem.clearCompletedBatches

export const getSwarmProgress = (id: string) => {
    const p = AgentSystem.getProgress(id)
    if (!p) return undefined
    return { ...p, swarmId: p.batchId }
}

export const onSwarmProgress = (id: string, cb: (p: AgentSystem.Progress & { swarmId: string }) => void) => {
    return AgentSystem.onProgress(id, (p) => {
        cb({ ...p, swarmId: p.batchId })
    })
}

export async function runSwarm(
    tasks: Array<{ agent: string; prompt: string; model?: string; priority?: number }>,
    executor: (task: AgentSystem.Task) => Promise<string>,
    config?: Partial<AgentSystem.Config>,
) {
    const result = await AgentSystem.run(tasks, executor, { ...config, mode: "swarm" })
    return {
        results: result.results,
        aggregated: result.aggregated,
    }
}


