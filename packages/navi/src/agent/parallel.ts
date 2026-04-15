/**
 * Navi Parallel Agent Manager
 *
 * This module provides enhanced parallel agent execution capabilities.
 * DEPRECATED: Use AgentSystem instead. This is a compatibility wrapper.
 */

import { AgentSystem } from "./agent-system"

export namespace ParallelAgent {
  export const TaskStatus = AgentSystem.Status
  export type TaskStatus = AgentSystem.Status

  export const Config = AgentSystem.Config
  export type Config = AgentSystem.Config

  export const Task = AgentSystem.Task
  export type Task = AgentSystem.Task

  export const Batch = AgentSystem.Batch
  export type Batch = AgentSystem.Batch

  export interface BatchProgress extends AgentSystem.Progress { }

  export const createTask = AgentSystem.createTask
  export const createBatch = AgentSystem.createBatch
  export const executeBatch = AgentSystem.execute

  export const getBatchProgress = AgentSystem.getProgress
  export const onProgress = AgentSystem.onProgress

  // Helper to map the old runParallel signature to the new AgentSystem.run
  export async function runParallel(
    tasks: Array<{ agent: string; prompt: string; priority?: number; model?: string }>,
    executor: (task: Task) => Promise<string>,
    config?: Partial<Config>,
  ) {
    const result = await AgentSystem.run(
      tasks.map(t => ({ ...t })),
      executor,
      { ...config, mode: "parallel" }
    )

    // Map result to match expected ParallelAgent output format if needed
    // The new system returns a slightly different structure but compatible enough for most uses
    // We add performance stub to match the old interface
    return {
      ...result,
      performance: {
        totalDuration: 0,
        avgTaskDuration: 0,
        operationMetrics: {}
      }
    }
  }
}


