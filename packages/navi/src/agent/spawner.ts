import { Log } from "../util/log"
import { v4 as uuid } from "uuid"
import os from "os"
import { EventEmitter } from "events"
import { Agent } from "../agent/agent"
import { MultiAgent, type AgentRole, type CollaborationTask, type Subtask } from "../agent/multi-agent"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { MessageID, SessionID } from "../session/schema"
import { ProviderID, ModelID } from "../provider/schema"

const log = Log.create({ service: "agent-spawner" })

export interface SpawnedAgent {
    id: string
    role: string
    task: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    result?: string
    error?: string
    startedAt: number
    finishedAt?: number
}

export interface SpawnerOptions {
    maxConcurrent?: number
    timeout?: number
    retryCount?: number
    enableParallel?: boolean
}

export interface TaskResult {
    taskId: string
    success: boolean
    result?: string
    error?: string
    duration: number
}

export class AgentSpawner extends EventEmitter {
    private spawnedAgents: Map<string, SpawnedAgent> = new Map()
    private taskQueue: Map<string, Subtask> = new Map()
    private maxConcurrent: number
    private timeout: number
    private retryCount: number
    private enableParallel: boolean
    private runningCount: number = 0

    constructor(options: SpawnerOptions = {}) {
        super()
        // Auto-scale concurrency based on CPU count
        this.maxConcurrent = options.maxConcurrent ?? Math.max(4, Math.min(os.cpus().length, 12))
        this.timeout = options.timeout ?? 30 * 60 * 1000 // 30 minutes
        this.retryCount = options.retryCount ?? 3
        this.enableParallel = options.enableParallel ?? true
    }

    async spawnAgent(
        role: AgentRole,
        task: string,
        context?: Record<string, unknown>
    ): Promise<SpawnedAgent> {
        const agentId = uuid()

        const agent: SpawnedAgent = {
            id: agentId,
            role,
            task,
            status: 'pending',
            startedAt: Date.now(),
        }

        this.spawnedAgents.set(agentId, agent)

        // Start execution
        this.executeAgent(agent, context)

        return agent
    }

    private async executeAgent(
        agent: SpawnedAgent,
        context?: Record<string, unknown>
    ): Promise<void> {
        agent.status = 'running'
        this.emit('agent:start', agent)

        try {
            // Get agent definition based on role
            const agentDefinition = await this.getAgentDefinition(agent.role)

            if (!agentDefinition) {
                throw new Error(`Agent definition not found for role: ${agent.role}`)
            }

            // Execute the agent
            const result = await this.runAgent(agentDefinition, agent.task, context)

            agent.status = 'completed'
            agent.result = result
            agent.finishedAt = Date.now()

            log.info("Agent execution completed", { agentId: agent.id, role: agent.role })
        } catch (error) {
            agent.status = 'failed'
            agent.error = error instanceof Error ? error.message : String(error)
            agent.finishedAt = Date.now()

            log.error("Agent execution failed", { agentId: agent.id, error: agent.error })
        } finally {
            this.runningCount--
            // Emit done event for event-based waiting
            this.emit(`agent:done:${agent.id}`, agent)
            this.emit('agent:done', agent)
            this.processQueue()
        }
    }

    private async getAgentDefinition(role: string): Promise<Agent.Info | null> {
        // Map roles to agent names
        const roleToAgent: Record<string, string> = {
            planner: 'planner',
            executor: 'build',
            reviewer: 'review',
            researcher: 'researcher',
            debugger: 'debug',
            architect: 'architect',
            investigator: 'investigator',
            frontend: 'frontend',
            backend: 'backend',
            devops: 'devops',
            security: 'security',
            qa: 'tester',
            database: 'database',
            documentation: 'documentation',
        }

        const agentName = roleToAgent[role] || role
        return await Agent.get(agentName)
    }

    private async runAgent(
        agentDefinition: Agent.Info,
        task: string,
        context?: Record<string, unknown>
    ): Promise<string> {
        // Create a new session for the agent
        const { Session } = await import("../session")
        const session = await Session.create({})

        // Run the agent
        const { SessionPrompt } = await import("../session/prompt")
        await SessionPrompt.command({
            sessionID: SessionID.make(session.id),
            messageID: MessageID.make(Identifier.ascending("message")),
            model: {
                providerID: ProviderID.make(agentDefinition.model?.providerID || 'anthropic'),
                modelID: ModelID.make(agentDefinition.model?.modelID || 'claude-3-5-sonnet-latest')
            },
            command: task,
            arguments: '',
        })

        // Get the final response
        const messages = await Session.messages({ sessionID: SessionID.make(session.id), limit: 10 })

        const assistantMessages = messages
            .filter(m => m.info.role === 'assistant')
            .reverse()

        if (assistantMessages.length > 0) {
            const lastMessage = assistantMessages[0]
            return lastMessage.parts
                .map(p => 'text' in p ? p.text : '')
                .join('\n')
        }

        return ''
    }

    async spawnCollaboration(task: string): Promise<CollaborationTask> {
        // Analyze if collaboration is needed
        const analysis = MultiAgent.analyze(task, 70)

        if (!analysis.needsCollaboration) {
            // Single agent execution
            const agent = await this.spawnAgent('executor', task)
            return {
                id: uuid(),
                description: task,
                subtasks: [{
                    id: uuid(),
                    description: task,
                    assignedTo: agent.id,
                    dependencies: [],
                    status: agent.status === 'completed' ? 'completed' : 'pending',
                }],
                agents: [{
                    id: 'agent-executor-0',
                    role: 'executor',
                    thinkingLevel: 'think',
                    capabilities: ['implementation', 'coding'],
                    tools: ['read', 'write', 'edit', 'bash'],
                }],
                coordinator: 'agent-executor-0',
                status: 'pending',
            }
        }

        // Create collaboration plan
        const collaboration = await MultiAgent.createPlan(task, analysis.suggestedAgents)

        // Spawn agents for each subtask
        for (const subtask of collaboration.subtasks) {
            const agent = await this.spawnAgent(subtask.assignedTo as AgentRole, subtask.description)
            subtask.assignedTo = agent.id
        }

        return collaboration
    }

    private processQueue(): void {
        if (!this.enableParallel || this.runningCount >= this.maxConcurrent) {
            return
        }

        // Process next task from queue
        for (const [taskId, subtask] of this.taskQueue) {
            if (subtask.status === 'pending' && this.runningCount < this.maxConcurrent) {
                this.taskQueue.delete(taskId)
                this.runningCount++

                const agent = this.spawnedAgents.get(subtask.assignedTo)
                if (agent) {
                    this.executeAgent(agent)
                }
            }
        }
    }

    async queueSubtask(subtask: Subtask): Promise<void> {
        this.taskQueue.set(subtask.id, subtask)
        this.processQueue()
    }

    /**
     * Wait for agent completion using event-based signaling.
     * No polling — uses EventEmitter 'once' listener with timeout.
     */
    async waitForCompletion(agentId: string, timeout?: number): Promise<SpawnedAgent | null> {
        const agent = this.spawnedAgents.get(agentId)
        if (!agent) return null

        // Already done
        if (agent.status === 'completed' || agent.status === 'failed') {
            return agent
        }

        const timeoutMs = timeout ?? this.timeout

        return new Promise((resolve) => {
            let timeoutId: ReturnType<typeof setTimeout>

            // Listen for the done event — no polling!
            const handler = (completedAgent: SpawnedAgent) => {
                clearTimeout(timeoutId)
                resolve(completedAgent)
            }

            this.once(`agent:done:${agentId}`, handler)

            timeoutId = setTimeout(() => {
                this.removeListener(`agent:done:${agentId}`, handler)
                resolve(this.spawnedAgents.get(agentId) || null)
            }, timeoutMs)
        })
    }

    /**
     * Register a callback for when any agent completes.
     */
    onAgentComplete(callback: (agent: SpawnedAgent) => void): () => void {
        this.on('agent:done', callback)
        return () => this.removeListener('agent:done', callback)
    }

    async getAgent(agentId: string): Promise<SpawnedAgent | null> {
        return this.spawnedAgents.get(agentId) || null
    }

    async listAgents(): Promise<SpawnedAgent[]> {
        return Array.from(this.spawnedAgents.values())
    }

    getRunningCount(): number {
        return this.runningCount
    }

    getMaxConcurrent(): number {
        return this.maxConcurrent
    }

    async reset(): Promise<void> {
        this.spawnedAgents.clear()
        this.taskQueue.clear()
        this.runningCount = 0
        this.removeAllListeners()
    }
}

export const Spawner = new AgentSpawner()


