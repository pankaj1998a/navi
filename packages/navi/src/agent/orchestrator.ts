import { ulid } from "ulid"
import { AgentInfo } from "./info"
import { Validator, ValidationResult } from "./validator"
import { AgentRunner } from "./agent-runner"

export type AgentType =
    | 'orchestrator'
    | 'file-picker'
    | 'planner'
    | 'editor'
    | 'reviewer'
    | 'researcher'
    | 'commander'
    | 'code-searcher'
    | 'context-pruner'
    | 'thinker'

export interface AgentTask {
    id: string
    type: AgentType
    description: string
    context?: Record<string, unknown>
    dependencies?: string[]
}

export type WorkflowStep =
    | AgentTask
    | { parallel: AgentTask[] }
    | (() => Promise<void>)

export interface AgentResult {
    taskId: string
    success: boolean
    output: string
    metrics?: {
        duration: number
        tokens: number
    }
    error?: string
}

export class WorkflowBuilder {
    private steps: WorkflowStep[] = []

    spawn(type: AgentType, description: string, options?: { dependencies?: string[]; context?: Record<string, unknown> }): this {
        this.steps.push({
            id: ulid(),
            type,
            description,
            dependencies: options?.dependencies,
            context: options?.context,
        })
        return this
    }

    /**
     * Add a group of tasks to execute in parallel.
     * All tasks in the group will run concurrently, and execution
     * proceeds to the next step only after all complete.
     */
    parallel(tasks: Array<{ type: AgentType; description: string; context?: Record<string, unknown> }>): this {
        this.steps.push({
            parallel: tasks.map(t => ({
                id: ulid(),
                type: t.type,
                description: t.description,
                context: t.context,
            }))
        })
        return this
    }

    run(fn: () => Promise<void>): this {
        this.steps.push(fn)
        return this
    }

    getSteps(): WorkflowStep[] {
        return this.steps
    }
}

export class Orchestrator {
    private status: 'idle' | 'running' | 'completed' | 'failed' = 'idle'
    private agents: Map<string, AgentInfo> = new Map()
    private runner: AgentRunner = new AgentRunner()
    private results: Map<string, AgentResult> = new Map()

    constructor() { }

    async spawnAgent(agentType: AgentType, task: AgentTask): Promise<AgentResult> {
        const start = Date.now()
        const results = await this.runner.runParallel([task])
        const result = results[0]
        if (result) {
            result.metrics = { ...result.metrics, duration: Date.now() - start, tokens: result.metrics?.tokens ?? 0 }
            this.results.set(task.id, result)
        }
        return result
    }

    async coordinateAgents(tasks: AgentTask[]): Promise<AgentResult[]> {
        this.status = 'running'
        const results = await this.executeDag(tasks)
        this.status = 'completed'
        return results
    }

    /**
     * DAG-based execution: tasks with no dependencies run in parallel,
     * tasks with dependencies wait until their dependencies complete.
     */
    private async executeDag(tasks: AgentTask[]): Promise<AgentResult[]> {
        const completed = new Set<string>()
        const results: AgentResult[] = []
        const remaining = new Set(tasks.map(t => t.id))

        while (remaining.size > 0) {
            // Find tasks whose dependencies are all completed
            const ready = tasks.filter(t =>
                remaining.has(t.id) &&
                (t.dependencies ?? []).every(dep => completed.has(dep))
            )

            if (ready.length === 0 && remaining.size > 0) {
                // Circular dependency or missing dep — run remaining sequentially to avoid deadlock
                const fallback = tasks.filter(t => remaining.has(t.id))
                for (const task of fallback) {
                    const result = await this.spawnAgent(task.type, task)
                    results.push(result)
                    completed.add(task.id)
                    remaining.delete(task.id)
                }
                break
            }

            // Execute all ready tasks in parallel
            const batchResults = await Promise.all(
                ready.map(task => this.spawnAgent(task.type, task))
            )

            for (let i = 0; i < ready.length; i++) {
                results.push(batchResults[i])
                completed.add(ready[i].id)
                remaining.delete(ready[i].id)
            }
        }

        return results
    }

    async executeWorkflow(builder: WorkflowBuilder): Promise<AgentResult[]> {
        this.status = 'running'
        const results: AgentResult[] = []
        const steps = builder.getSteps()

        for (const step of steps) {
            if (typeof step === 'function') {
                await step()
            } else if ('parallel' in step) {
                // Execute all tasks in the parallel group concurrently
                const parallelResults = await Promise.all(
                    step.parallel.map(task => this.spawnAgent(task.type, task))
                )
                results.push(...parallelResults)
            } else {
                // Check if this task has unsatisfied dependencies
                const deps = step.dependencies ?? []
                const allDepsCompleted = deps.every(depId =>
                    results.some(r => r.taskId === depId && r.success)
                )

                if (deps.length > 0 && !allDepsCompleted) {
                    results.push({
                        taskId: step.id,
                        success: false,
                        output: '',
                        error: `Dependencies not met: ${deps.join(', ')}`,
                    })
                    continue
                }

                const result = await this.spawnAgent(step.type, step)
                results.push(result)
            }
        }

        this.status = 'completed'
        return results
    }

    async *generatorWorkflow(goal: string, cwd: string): AsyncGenerator<AgentResult | ValidationResult> {
        this.status = 'running'

        // Planning
        yield await this.spawnAgent('planner', {
            id: ulid(),
            type: 'planner',
            description: `Plan for: ${goal}`,
        })

        // Execution
        const editResult = await this.spawnAgent('editor', {
            id: ulid(),
            type: 'editor',
            description: `Execute changes for: ${goal}`,
        })
        yield editResult

        // Self-Healing Validation Loop
        let attempts = 0
        const maxAttempts = 3
        while (attempts < maxAttempts) {
            const validationResults = await Validator.validateEdits(cwd)
            const failedCheck = validationResults.find(r => !r.success)

            if (!failedCheck) break // All clear

            yield {
                taskId: 'validation-failure',
                success: false,
                output: failedCheck.output,
            } as AgentResult

            // Spawn "Fixer" agent
            yield await this.spawnAgent('editor', {
                id: ulid(),
                type: 'editor',
                description: `Fix validation errors: ${failedCheck.errors.join(', ')}`,
                context: { errorOutput: failedCheck.output }
            })

            attempts++
        }

        this.status = 'completed'
    }

    // Expose LSP as sub-agent tools
    async useLSP(method: 'definition' | 'references' | 'typeDefinition', symbol: string, file: string): Promise<Record<string, unknown>> {
        return {
            symbol,
            location: { file, line: 10, character: 5 }
        }
    }

    /**
     * Get result for a specific task by ID
     */
    getResult(taskId: string): AgentResult | undefined {
        return this.results.get(taskId)
    }

    getOrchestratorStatus() {
        return this.status
    }
}
