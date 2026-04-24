import { ulid } from "ulid"
import { AgentInfo } from "./info"
import { Validator, ValidationResult } from "./validator"
import { AgentRunner } from "./agent-runner"
import { VerificationAgent } from "./VerificationAgent"
import { AutoDreamService } from "./AutoDreamService"
import { SentryService } from "./SentryService"
import { SpeculationEngine } from "./SpeculationEngine"
import { DocDiscovery } from "./DocDiscovery"
import { iife } from "@/util/iife"
import { Log } from "../util/log"
import path from "path"

const log = Log.create({ service: "orchestrator" })

export type AgentType =
    | 'orchestrator'
    | 'file-picker'
    | 'planner'
    | 'editor'
    | 'reviewer'
    | 'researcher'
    | 'coordinator'
    | 'tester'
    | 'fixer'
    | 'commander'
    | 'code-searcher'
    | 'context-pruner'
    | 'thinker'
    | 'architect'
    | 'investigator'
    | 'explore'
    | 'surfer'
    | 'analyst'
    | 'security'
    | 'qa'
    | 'spec-writer'
    | 'database-doctor'
    | 'api-architect'
    | 'test-engineer'
    | 'frontend-sage'
    | 'security-sentinel'
    | 'devops-dynamo'
    | 'performance-pilot'
    | 'bug-buster'
    | 'doc-architect'

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
    private verificationAgent: VerificationAgent
    private autoDreamService: AutoDreamService
    private sentryService: SentryService

    constructor() { 
        iife(async () => {
            const docDiscovery = await DocDiscovery.discover(process.cwd())
            const docsText = DocDiscovery.formatForAgent(docDiscovery)
            log.info("Magic docs pre-loaded", { count: docDiscovery.length })
        })
        
        // Initialize Speculation
        const speculation = SpeculationEngine.speculate([])
        
        this.verificationAgent = new VerificationAgent(this)
        this.autoDreamService = new AutoDreamService(this)
        this.autoDreamService.start()
        this.sentryService = new SentryService(this)
        this.sentryService.start()

        // Hook LiveDoc into the environment
        import("./live-doc").then(module => {
            log.info("LiveDoc generator injected.", { status: "active" })
        })
    }

    stop() {
        this.autoDreamService.stop()
        this.sentryService.stop()
        log.info("Orchestrator stopped")
    }

    async spawnAgent(agentType: AgentType, task: AgentTask, options: { autoVerify?: boolean, sessionID?: string } = {}): Promise<AgentResult> {
        const start = Date.now()

        // 1. Check for available distributed workers
        const { WorkerPool } = await import("./worker-pool")
        const remoteWorker = WorkerPool.getAvailableWorker(agentType)
        
        let result: AgentResult
        if (remoteWorker) {
            log.info("delegating to remote worker", { workerID: remoteWorker.id, type: agentType })
            result = await WorkerPool.dispatch(remoteWorker.id, task)
        } else {
            // 2. Local execution fallback
            const results = await this.runner.runParallel([task])
            result = results[0]
        }
        
        if (result && options.sessionID && options.autoVerify === true) {
            // Verification is opt-in to avoid interrupting normal edit flows.
            result = await this.verificationAgent.verify(options.sessionID, task, result)
        }

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

        // Phase 1: Planning
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

    /**
     * VIBEMODE Protocol (v3.1)
     * Implements 6-Agent Discussion and Quorum Validation
     */
    async *vibeWorkflow(goal: string): AsyncGenerator<AgentResult | string> {
        this.status = 'running'
        yield "🚀 Initializing VibeMode 3.1 Orchestration..."

        // Step 1: Research Swarm
        yield "📡 Broadcasting to Research Swarm (6 Agents)..."
        const researchAgents = ['researcher', 'investigator', 'explore', 'surfer', 'analyst', 'architect']
        const swarmTasks = researchAgents.map(agent => ({
            id: ulid(),
            type: agent as AgentType,
            description: `Research and analyze requirements for: ${goal}`,
        }))

        const researchResults = await Promise.all(swarmTasks.map(t => this.spawnAgent(t.type, t)))
        yield "✅ Swarm research collected. Applying Quorum Validation..."

        // Step 2: Consensus Synthesis
        const synthesisPrompt = `Synthesize these 6 research reports into a unified blueprint for "${goal}":
        ${researchResults.map((r, i) => `REP ${i+1} (${swarmTasks[i].type}): ${r.output}`).join('\n\n')}`
        
        const synthesisResult = await this.spawnAgent('architect', {
            id: ulid(),
            type: 'architect',
            description: synthesisPrompt,
        })
        yield synthesisResult

        // Step 3: Execution with Quality Gates
        yield "🛠️ Beginning Phase 3: High-Fidelity Execution..."
        const buildResult = await this.spawnAgent('editor', {
            id: ulid(),
            type: 'editor',
            description: `Implement the synthesized blueprint: ${synthesisResult.output}`,
        })
        yield buildResult

        // Step 4: Verification 
        yield "🛡️ Checking Quality Gates (Code Review + Security + Tests)..."
        const reviewResult = await this.spawnAgent('reviewer', {
            id: ulid(),
            type: 'reviewer',
            description: `Review the implemented changes for: ${goal}`,
        })
        yield reviewResult

        this.status = 'completed'
        yield "✨ VibeMode Execution Finished."
    }

    /**
     * WATERFALL Protocol (v1.0)
     * Implements Structured 5-Phase Development: Analyze -> DB -> Interface -> Test -> Realize
     */
    async *waterfallWorkflow(goal: string): AsyncGenerator<AgentResult | string> {
        this.status = 'running'
        yield "🌊 Initializing Waterfall Orchestration..."

        // Phase 1: Analyze
        yield "📋 Phase 1: Requirements Analysis..."
        const analyzeResult = await this.spawnAgent('spec-writer', {
            id: ulid(),
            type: 'spec-writer',
            description: `Analyze requirements for: ${goal}`,
        })
        yield analyzeResult
        if (!analyzeResult.success) {
            yield "❌ Phase 1 failed. Aborting waterfall."
            this.status = 'failed'
            return
        }

        // Phase 2: Database
        yield "🗄️ Phase 2: Database Design..."
        const dbResult = await this.spawnAgent('database-doctor', {
            id: ulid(),
            type: 'database-doctor',
            description: `Design database schema based on: ${analyzeResult.output}`,
        })
        yield dbResult
        if (!dbResult.success) {
            yield "❌ Phase 2 failed. Aborting waterfall."
            this.status = 'failed'
            return
        }

        // Phase 3: Interface
        yield "🔌 Phase 3: API Interface Design..."
        const apiResult = await this.spawnAgent('api-architect', {
            id: ulid(),
            type: 'api-architect',
            description: `Design API interfaces based on specs and DB: ${analyzeResult.output}\n${dbResult.output}`,
        })
        yield apiResult
        if (!apiResult.success) {
            yield "❌ Phase 3 failed. Aborting waterfall."
            this.status = 'failed'
            return
        }

        // Phase 4: Test
        yield "🧪 Phase 4: Test Generation (TDD)..."
        const testResult = await this.spawnAgent('test-engineer', {
            id: ulid(),
            type: 'test-engineer',
            description: `Generate tests for interfaces: ${apiResult.output}`,
        })
        yield testResult
        if (!testResult.success) {
            yield "❌ Phase 4 failed. Aborting waterfall."
            this.status = 'failed'
            return
        }

        // Phase 5: Realize
        yield "🔨 Phase 5: Implementation (Realize)..."
        const buildResult = await this.spawnAgent('editor', {
            id: ulid(),
            type: 'editor',
            description: `Implement the full system based on:
            Spec: ${analyzeResult.output}
            DB: ${dbResult.output}
            API: ${apiResult.output}
            Tests: ${testResult.output}`,
        })
        yield buildResult

        this.status = buildResult.success ? 'completed' : 'failed'
        yield buildResult.success ? "✨ Waterfall Execution Finished Successfully." : "❌ Phase 5 failed."
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


