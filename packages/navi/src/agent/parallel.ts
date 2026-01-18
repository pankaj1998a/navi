/**
 * Navi Parallel Agent Manager
 *
 * This module provides enhanced parallel agent execution capabilities,
 * allowing multiple AI agents to work concurrently on different tasks.
 *
 * Key features:
 * - True parallel execution of multiple agents
 * - Result aggregation and conflict resolution
 * - Progress tracking across all running agents
 * - Resource management and rate limiting
 */

import { ulid } from "ulid"
import z from "zod"

export namespace ParallelAgent {
  /**
   * Status of a parallel agent task
   */
  export const TaskStatus = z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
  ])
  export type TaskStatus = z.infer<typeof TaskStatus>

  /**
   * Configuration for parallel execution
   */
  export const Config = z.object({
    maxConcurrent: z.number().int().positive().default(4),
    timeoutMs: z.number().int().positive().default(300000), // 5 minutes
    retryOnFailure: z.boolean().default(false),
    maxRetries: z.number().int().nonnegative().default(3),
    aggregateResults: z.boolean().default(true),
  })
  export type Config = z.infer<typeof Config>

  /**
   * A single task to be executed by an agent
   */
  export const Task = z.object({
    id: z.string(),
    agentName: z.string(),
    prompt: z.string(),
    status: TaskStatus,
    priority: z.number().int().default(0),
    createdAt: z.number(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
    result: z.string().optional(),
    error: z.string().optional(),
    retryCount: z.number().int().default(0),
  })
  export type Task = z.infer<typeof Task>

  /**
   * A batch of tasks to be executed in parallel
   */
  export const Batch = z.object({
    id: z.string(),
    tasks: z.array(Task),
    config: Config,
    status: TaskStatus,
    createdAt: z.number(),
    completedAt: z.number().optional(),
    aggregatedResult: z.string().optional(),
  })
  export type Batch = z.infer<typeof Batch>

  /**
   * Progress update for a running batch
   */
  export interface BatchProgress {
    batchId: string
    totalTasks: number
    completedTasks: number
    failedTasks: number
    runningTasks: number
    pendingTasks: number
    percentComplete: number
    estimatedTimeRemaining?: number
  }

  // Internal state
  const batches = new Map<string, Batch>()
  const progressListeners = new Map<string, Set<(progress: BatchProgress) => void>>()

  /**
   * Create a new task
   */
  export function createTask(agentName: string, prompt: string, priority = 0): Task {
    return {
      id: ulid(),
      agentName,
      prompt,
      status: "pending",
      priority,
      createdAt: Date.now(),
      retryCount: 0,
    }
  }

  /**
   * Create a new batch of tasks
   */
  export function createBatch(tasks: Task[], config?: Partial<Config>): Batch {
    const fullConfig = Config.parse(config ?? {})
    return {
      id: ulid(),
      tasks,
      config: fullConfig,
      status: "pending",
      createdAt: Date.now(),
    }
  }

  /**
   * Execute a batch of tasks in parallel
   */
  export async function executeBatch(
    batch: Batch,
    executor: (task: Task) => Promise<string>,
  ): Promise<Batch> {
    batches.set(batch.id, { ...batch, status: "running" })
    notifyProgress(batch.id)

    const { maxConcurrent, timeoutMs, retryOnFailure, maxRetries } = batch.config
    const pendingTasks = [...batch.tasks].sort((a, b) => b.priority - a.priority)
    const runningTasks: Promise<void>[] = []
    let taskIndex = 0

    const executeTask = async (task: Task): Promise<void> => {
      task.status = "running"
      task.startedAt = Date.now()
      notifyProgress(batch.id)

      try {
        const result = await Promise.race([
          executor(task),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Task timeout")), timeoutMs)
          ),
        ])

        task.status = "completed"
        task.completedAt = Date.now()
        task.result = result
      } catch (error) {
        if (retryOnFailure && task.retryCount < maxRetries) {
          task.retryCount++
          task.status = "pending"
          pendingTasks.push(task)
        } else {
          task.status = "failed"
          task.completedAt = Date.now()
          task.error = error instanceof Error ? error.message : String(error)
        }
      }

      notifyProgress(batch.id)
    }

    // Process tasks with concurrency limit
    while (taskIndex < pendingTasks.length || runningTasks.length > 0) {
      // Start new tasks up to the concurrency limit
      while (runningTasks.length < maxConcurrent && taskIndex < pendingTasks.length) {
        const task = pendingTasks[taskIndex++]
        if (task.status === "pending") {
          const promise = executeTask(task).then(() => {
            const index = runningTasks.indexOf(promise)
            if (index > -1) runningTasks.splice(index, 1)
          })
          runningTasks.push(promise)
        }
      }

      // Wait for at least one task to complete
      if (runningTasks.length > 0) {
        await Promise.race(runningTasks)
      }
    }

    // Update batch status
    const allCompleted = batch.tasks.every(
      (t) => t.status === "completed" || t.status === "failed"
    )
    const anyFailed = batch.tasks.some((t) => t.status === "failed")

    batch.status = allCompleted ? (anyFailed ? "failed" : "completed") : "running"
    batch.completedAt = Date.now()

    // Aggregate results if configured
    if (batch.config.aggregateResults) {
      batch.aggregatedResult = aggregateResults(batch.tasks)
    }

    batches.set(batch.id, batch)
    notifyProgress(batch.id)

    return batch
  }

  /**
   * Aggregate results from multiple completed tasks
   */
  function aggregateResults(tasks: Task[]): string {
    const completedTasks = tasks.filter((t) => t.status === "completed" && t.result)
    const failedTasks = tasks.filter((t) => t.status === "failed")

    let result = "# Parallel Agent Execution Results\n\n"

    if (completedTasks.length > 0) {
      result += "## Completed Tasks\n\n"
      for (const task of completedTasks) {
        result += `### @${task.agentName}\n\n`
        result += `${task.result}\n\n`
        result += `---\n\n`
      }
    }

    if (failedTasks.length > 0) {
      result += "## Failed Tasks\n\n"
      for (const task of failedTasks) {
        result += `### @${task.agentName}\n\n`
        result += `**Error:** ${task.error}\n\n`
      }
    }

    return result
  }

  /**
   * Get the current progress of a batch
   */
  export function getBatchProgress(batchId: string): BatchProgress | undefined {
    const batch = batches.get(batchId)
    if (!batch) return undefined

    const completed = batch.tasks.filter((t) => t.status === "completed").length
    const failed = batch.tasks.filter((t) => t.status === "failed").length
    const running = batch.tasks.filter((t) => t.status === "running").length
    const pending = batch.tasks.filter((t) => t.status === "pending").length
    const total = batch.tasks.length

    return {
      batchId,
      totalTasks: total,
      completedTasks: completed,
      failedTasks: failed,
      runningTasks: running,
      pendingTasks: pending,
      percentComplete: total > 0 ? Math.round(((completed + failed) / total) * 100) : 0,
    }
  }

  /**
   * Subscribe to progress updates for a batch
   */
  export function onProgress(
    batchId: string,
    callback: (progress: BatchProgress) => void,
  ): () => void {
    if (!progressListeners.has(batchId)) {
      progressListeners.set(batchId, new Set())
    }
    progressListeners.get(batchId)!.add(callback)

    // Return unsubscribe function
    return () => {
      progressListeners.get(batchId)?.delete(callback)
    }
  }

  /**
   * Notify all listeners of progress update
   */
  function notifyProgress(batchId: string): void {
    const progress = getBatchProgress(batchId)
    if (!progress) return

    const listeners = progressListeners.get(batchId)
    if (listeners) {
      for (const callback of listeners) {
        callback(progress)
      }
    }
  }

  /**
   * Cancel a running batch
   */
  export function cancelBatch(batchId: string): boolean {
    const batch = batches.get(batchId)
    if (!batch || batch.status !== "running") return false

    for (const task of batch.tasks) {
      if (task.status === "pending" || task.status === "running") {
        task.status = "cancelled"
        task.completedAt = Date.now()
      }
    }

    batch.status = "cancelled"
    batch.completedAt = Date.now()
    batches.set(batchId, batch)
    notifyProgress(batchId)

    return true
  }

  /**
   * Get a batch by ID
   */
  export function getBatch(batchId: string): Batch | undefined {
    return batches.get(batchId)
  }

  /**
   * List all batches
   */
  export function listBatches(): Batch[] {
    return Array.from(batches.values())
  }

  /**
   * Clear completed/failed batches
   */
  export function clearCompletedBatches(): number {
    let count = 0
    for (const [id, batch] of batches) {
      if (batch.status === "completed" || batch.status === "failed" || batch.status === "cancelled") {
        batches.delete(id)
        progressListeners.delete(id)
        count++
      }
    }
    return count
  }

  /**
   * Helper function to run multiple agents in parallel with a simple API
   *
   * @example
   * ```typescript
   * const results = await ParallelAgent.runParallel([
   *   { agent: 'code', prompt: 'Fix the authentication bug' },
   *   { agent: 'docs', prompt: 'Update the README' },
   *   { agent: 'test', prompt: 'Write unit tests' },
   * ])
   * ```
   */
  export async function runParallel(
    tasks: Array<{ agent: string; prompt: string; priority?: number }>,
    executor: (task: Task) => Promise<string>,
    config?: Partial<Config>,
  ): Promise<{
    results: Array<{ agent: string; success: boolean; result?: string; error?: string }>
    aggregated: string
  }> {
    const taskObjects = tasks.map((t) => createTask(t.agent, t.prompt, t.priority ?? 0))
    const batch = createBatch(taskObjects, config)
    const completedBatch = await executeBatch(batch, executor)

    return {
      results: completedBatch.tasks.map((t) => ({
        agent: t.agentName,
        success: t.status === "completed",
        result: t.result,
        error: t.error,
      })),
      aggregated: completedBatch.aggregatedResult ?? "",
    }
  }
}
