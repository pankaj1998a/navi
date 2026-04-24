/**
 * Navi Unified Agent System
 *
 * This module merges the capabilities of ParallelAgent and Swarm systems into a single,
 * robust orchestration engine. It supports multiple execution modes:
 * - Parallel: high-throughput independent task execution
 * - Swarm: collaborative execution with consensus capabilities
 * - Sequential: ordered execution for dependent tasks
 */

import { ulid } from "ulid"
import z from "zod"
import os from "os"
import { Performance } from "../util/performance"
import { Log } from "../util/log"
import * as ProgrammaticAgents from "./programmatic"

const log = Log.create({ service: "agent-system" })

export namespace AgentSystem {
    /**
     * Execution mode for the agent system
     */
    export const ExecutionMode = z.enum(["parallel", "swarm", "sequential", "programmatic"])
    export type ExecutionMode = z.infer<typeof ExecutionMode>

    /**
     * Programmatic Agent submodule
     */
    export import Programmatic = ProgrammaticAgents

    /**
     * Status of a task or batch
     */
    export const Status = z.enum([
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
    ])
    export type Status = z.infer<typeof Status>

    /**
     * Configuration for execution
     */
    export const Config = z.object({
        mode: ExecutionMode.default("parallel"),
        maxConcurrent: z.number().int().positive().default(Math.max(4, Math.min(os.cpus().length, 16))),
        timeoutMs: z.number().int().positive().default(300000), // 5 minutes
        retryOnFailure: z.boolean().default(false),
        maxRetries: z.number().int().nonnegative().default(3),
        aggregateResults: z.boolean().default(true),
        strategy: z.enum(["all", "consensus", "best_of"]).default("all"),
        consensusThreshold: z.number().min(0).max(1).default(0.7),
        emitPart: z.function().optional(),
    })
    export type Config = z.infer<typeof Config>

    /**
     * A single task to be executed
     */
    export const Task = z.object({
        id: z.string(),
        agentName: z.string(),
        model: z.string().optional(),
        prompt: z.string(),
        status: Status,
        priority: z.number().int().default(0),
        createdAt: z.number(),
        startedAt: z.number().optional(),
        completedAt: z.number().optional(),
        result: z.string().optional(),
        error: z.string().optional(),
        retryCount: z.number().int().default(0),
        dependencies: z.array(z.string()).default([]),
        metadata: z.record(z.string(), z.any()).default({}),
    })
    export type Task = z.infer<typeof Task>

    /**
     * A batch of tasks to be executed together
     */
    export const Batch = z.object({
        id: z.string(),
        tasks: z.array(Task),
        config: Config,
        status: Status,
        createdAt: z.number(),
        completedAt: z.number().optional(),
        aggregatedResult: z.string().optional(),
    })
    export type Batch = z.infer<typeof Batch>

    /**
     * Progress update interface
     */
    export interface Progress {
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
    const progressListeners = new Map<string, Set<(progress: Progress) => void>>()

    /**
     * Create a new task
     */
    export function createTask(
        agentName: string,
        prompt: string,
        options: { model?: string; priority?: number; dependencies?: string[]; metadata?: Record<string, any> } = {}
    ): Task {
        return {
            id: ulid(),
            agentName,
            prompt,
            model: options.model,
            priority: options.priority ?? 0,
            dependencies: options.dependencies ?? [],
            metadata: options.metadata ?? {},
            status: "pending",
            createdAt: Date.now(),
            retryCount: 0,
        }
    }

    /**
     * Create a new execution batch
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
     * Execute a batch of tasks
     */
    export async function execute(
        batch: Batch,
        executor: (task: Task) => Promise<string>
    ): Promise<Batch> {
        batches.set(batch.id, { ...batch, status: "running" })
        notifyProgress(batch.id)

        const { mode, maxConcurrent, timeoutMs, retryOnFailure, maxRetries } = batch.config

        try {
            if (mode === "sequential") {
                await executeSequential(batch, executor, timeoutMs, retryOnFailure, maxRetries)
            } else {
                await executeParallel(batch, executor, maxConcurrent, timeoutMs, retryOnFailure, maxRetries)
            }

            // Finalize batch status
            const allCompleted = batch.tasks.every(
                (t) => t.status === "completed" || t.status === "failed"
            )
            const anyFailed = batch.tasks.some((t) => t.status === "failed")

            batch.status = allCompleted ? (anyFailed ? "failed" : "completed") : "running"
            batch.completedAt = Date.now()

            // Aggregation strategies
            if (batch.config.strategy === "consensus" || batch.config.strategy === "best_of") {
                batch.aggregatedResult = await runConsensus(batch, executor)
            } else if (batch.config.aggregateResults) {
                batch.aggregatedResult = aggregateResults(batch.tasks)
            }

        } catch (error) {
            log.error("Batch execution failed", { batchId: batch.id, error })
            batch.status = "failed"
            batch.completedAt = Date.now()
        }

        batches.set(batch.id, batch)
        notifyProgress(batch.id)

        return batch
    }

    async function executeSequential(
        batch: Batch,
        executor: (task: Task) => Promise<string>,
        timeoutMs: number,
        retryOnFailure: boolean,
        maxRetries: number
    ) {
        for (const task of batch.tasks) {
            if (batch.status === "cancelled") break
            await runTask(batch, task, executor, timeoutMs, retryOnFailure, maxRetries)
            notifyProgress(batch.id)
        }
    }

    async function executeParallel(
        batch: Batch,
        executor: (task: Task) => Promise<string>,
        maxConcurrent: number,
        timeoutMs: number,
        retryOnFailure: boolean,
        maxRetries: number
    ) {
        const pendingTasks = [...batch.tasks].sort((a, b) => b.priority - a.priority)
        const runningTasks: Promise<void>[] = []
        let taskIndex = 0

        while ((taskIndex < pendingTasks.length || runningTasks.length > 0) && batch.status !== "cancelled") {
            // Fill execution slots
            while (runningTasks.length < maxConcurrent && taskIndex < pendingTasks.length) {
                const task = pendingTasks[taskIndex++]
                if (task.status === "pending") {
                    const promise = runTask(batch, task, executor, timeoutMs, retryOnFailure, maxRetries)
                        .then(() => {
                            const index = runningTasks.indexOf(promise)
                            if (index > -1) runningTasks.splice(index, 1)
                            notifyProgress(batch.id)
                        })
                    runningTasks.push(promise)
                }
            }
            if (runningTasks.length > 0) {
                await Promise.race(runningTasks)
            }
        }
    }

    async function runTask(
        batch: Batch,
        task: Task,
        executor: (task: Task) => Promise<string>,
        timeoutMs: number,
        retryOnFailure: boolean,
        maxRetries: number
    ) {
        task.status = "running"
        task.startedAt = Date.now()

        try {
            let result: string

            // Check if this is a programmatic agent
            const programmaticTemplate = Programmatic.AgentRegistry.get(task.agentName)
            if (programmaticTemplate) {
                log.info("Executing task with programmatic agent", {
                    agent: task.agentName,
                    taskId: task.id
                })
                result = await Programmatic.ProgrammaticAgentRuntime.execute(
                    task.agentName,
                    task.prompt,
                    task.id, // Using taskId as sessionID
                    async (name, input) => {
                        // Here we'd ideally use a real tool executor. 
                        // For now, let's assume the provided executor can handle it if we wrap it?
                        // Actually, tasks in AgentSystem are usually self-contained.
                        // We might need a better way to execute tools from programmatic agents.
                        return executor(createTask(task.agentName, `Execute tool ${name} with ${JSON.stringify(input)}`))
                    },
                    {
                        emitPart: batch.config.emitPart as any
                    }
                )
            } else {
                result = await Performance.runWithTimeout(
                    async () => executor(task),
                    timeoutMs,
                    `agent:${task.agentName}:${task.model || 'default'}`
                )
            }

            task.status = "completed"
            task.completedAt = Date.now()
            task.result = result
        } catch (error) {
            if (retryOnFailure && task.retryCount < maxRetries) {
                task.retryCount++
                task.status = "pending"
                // Exponential backoff with jitter before retry
                const delay = Math.min(1000 * Math.pow(2, task.retryCount), 30000) + Math.random() * 1000
                await new Promise(r => setTimeout(r, delay))
                await runTask(batch, task, executor, timeoutMs, retryOnFailure, maxRetries)
            } else {
                task.status = "failed"
                task.completedAt = Date.now()
                task.error = error instanceof Error ? error.message : String(error)
            }
        }
    }

    /**
     * Run consensus logic
     */
    async function runConsensus(
        batch: Batch,
        executor: (task: Task) => Promise<string>
    ): Promise<string> {
        const completedTasks = batch.tasks.filter(t => t.status === "completed" && t.result)
        if (completedTasks.length < 2) return aggregateResults(batch.tasks)

        const reviewPrompt = `Compare the following ${completedTasks.length} results for the task: "${batch.tasks[0].prompt}"
    
    ${completedTasks.map((t, i) => `Result ${i + 1} (Agent: ${t.agentName}, Model: ${t.model || "default"}):\n${t.result}\n---\n`).join("\n")}
    
    Which result is the most accurate and high-quality? Or can you merge them into a single superior result?
    Return the final "Best Result" followed by a brief rationale.`

        const reviewerTask = createTask("review", reviewPrompt, { priority: 100 })
        try {
            const bestResult = await executor(reviewerTask)
            return `# Consensus Result\n\n${bestResult}`
        } catch (error) {
            return aggregateResults(batch.tasks)
        }
    }

    /**
     * Aggregate results
     */
    export function aggregateResults(tasks: Task[]): string {
        const completedTasks = tasks.filter((t) => t.status === "completed" && t.result)
        const failedTasks = tasks.filter((t) => t.status === "failed")

        let result = "# Execution Results\n\n"

        if (completedTasks.length > 0) {
            result += `## Completed Tasks (${completedTasks.length}/${tasks.length})\n\n`
            for (const task of completedTasks) {
                result += `### @${task.agentName} ${task.model ? `(${task.model})` : ''}\n`
                result += `> ${task.prompt.split('\n')[0].slice(0, 100)}${task.prompt.length > 100 ? '...' : ''}\n\n`
                result += `${task.result}\n\n`
                result += `---\n\n`
            }
        }

        if (failedTasks.length > 0) {
            result += `## Failed Tasks (${failedTasks.length}/${tasks.length})\n\n`
            for (const task of failedTasks) {
                result += `### @${task.agentName}\n`
                result += `**Error:** ${task.error}\n\n`
            }
        }

        return result
    }

    /**
     * Get batch progress
     */
    export function getProgress(batchId: string): Progress | undefined {
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
     * Subscribe to progress updates
     */
    export function onProgress(
        batchId: string,
        callback: (progress: Progress) => void
    ): () => void {
        if (!progressListeners.has(batchId)) {
            progressListeners.set(batchId, new Set())
        }
        progressListeners.get(batchId)!.add(callback)

        return () => {
            progressListeners.get(batchId)?.delete(callback)
        }
    }

    function notifyProgress(batchId: string): void {
        const progress = getProgress(batchId)
        if (!progress) return
        const listeners = progressListeners.get(batchId)
        if (listeners) {
            for (const callback of listeners) {
                callback(progress)
            }
        }
    }

    /**
     * Simple API for running tasks
     */
    export async function run(
        tasks: Array<{ agent: string; prompt: string; model?: string; priority?: number }>,
        executor: (task: Task) => Promise<string>,
        config?: Partial<Config>
    ) {
        const taskObjects = tasks.map((t) => createTask(t.agent, t.prompt, { model: t.model, priority: t.priority }))
        const batch = createBatch(taskObjects, config)

        const completedBatch = await Performance.profiler.profile(
            "agent-system-execution",
            () => execute(batch, executor),
            { taskCount: tasks.length, mode: config?.mode ?? "parallel" }
        )

        return {
            results: completedBatch.tasks.map((t: Task) => ({
                agent: t.agentName,
                success: t.status === "completed",
                result: t.result,
                error: t.error
            })),
            aggregated: completedBatch.aggregatedResult ?? "",
            batchId: completedBatch.id
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

    // Cleanup interval
    setInterval(() => {
        const now = Date.now()
        const maxAge = 3600000 // 1 hour
        for (const [id, batch] of batches.entries()) {
            if (batch.status !== "running" && batch.status !== "pending") {
                if (batch.completedAt && now - batch.completedAt > maxAge) {
                    batches.delete(id)
                    progressListeners.delete(id)
                }
            }
        }
    }, 300000).unref()
}


