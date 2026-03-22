import { Agent } from "./agent"
import { AgentTask, AgentResult } from "./orchestrator"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { v4 as uuid } from "uuid"

export type AgentConfig = Agent.Info

export class AgentInstance {
    public readonly id: string
    private config: AgentConfig
    private sessionID?: string

    constructor(config: AgentConfig) {
        this.id = uuid()
        this.config = config
    }

    async execute(input: string): Promise<string> {

        // Create session
        const session = await Session.create({})
        this.sessionID = session.id

        // Determine model
        let modelString = 'opencode/big-pickle' // Default to opencode provider if all else fails
        if (this.config.model) {
            modelString = `${this.config.model.providerID}/${this.config.model.modelID}`
        } else {
            // Default to opencode/big-pickle if no specific configuration is found
            modelString = 'opencode/big-pickle'
        }




        // Execute prompt using SessionPrompt
        await SessionPrompt.prompt({
            sessionID: session.id,
            messageID: Identifier.ascending("message"),
            model: {
                providerID: modelString.split('/')[0],
                modelID: modelString.split('/').slice(1).join('/')
            },
            agent: this.config.name,
            parts: [{ type: "text", text: input }]
        })



        // Capture result
        const messages = await Session.messages({ sessionID: session.id, limit: 10 })
        const assistantMessages = messages
            .filter(m => m.info.role === 'assistant')
            .reverse()

        if (assistantMessages.length > 0) {
            const lastMessage = assistantMessages[0]
            return lastMessage.parts
                .map(p => 'text' in p ? p.text : '')
                .join('\n')
        }
        return ""
    }
}

export class AgentRunner {
    private agents: Map<string, AgentInstance> = new Map()
    private maxConcurrent: number = 5
    private running: Set<string> = new Set()

    async spawnAgent(config: AgentConfig): Promise<AgentInstance> {
        const agent = new AgentInstance(config)
        this.agents.set(agent.id, agent)
        return agent
    }

    async runParallel(tasks: AgentTask[]): Promise<AgentResult[]> {
        const queue = [...tasks]
        const activePromises: Map<string, Promise<void>> = new Map()
        const results: AgentResult[] = []

        const executeTask = async (task: AgentTask) => {
            let config: AgentConfig | undefined
            try {
                // Attempt to get agent config. If exact match fails, try mapping or defaults.
                // Note: AgentType in Orchestrator might not match exact Agent keys.
                config = await Agent.get(task.type)
                if (!config) {
                    // Try mapping common aliases if needed, or fallback
                    if (task.type === 'editor') config = await Agent.get('coding')
                    if (task.type === 'commander') config = await Agent.get('general')
                    if (task.type === 'code-searcher') config = await Agent.get('explore')
                }
            } catch (e) {
                // ignore
            }

            if (!config) {
                results.push({ taskId: task.id, success: false, output: '', error: `Agent type ${task.type} not found` })
                return
            }

            const agent = await this.spawnAgent(config)
            this.running.add(agent.id)

            try {
                const result = await agent.execute(task.description)
                results.push({ taskId: task.id, success: true, output: result })
            } catch (error) {

                results.push({ taskId: task.id, success: false, output: '', error: error instanceof Error ? error.message : String(error) })
            } finally {
                this.running.delete(agent.id)
                this.agents.delete(agent.id) // Cleanup
            }
        }

        while (queue.length > 0 || activePromises.size > 0) {
            // Fill the queue
            while (activePromises.size < this.maxConcurrent && queue.length > 0) {
                const task = queue.shift()!
                const promise = executeTask(task).then(() => {
                    activePromises.delete(task.id)
                })
                activePromises.set(task.id, promise)
            }

            if (activePromises.size > 0) {
                // Wait for at least one to finish
                await Promise.race(activePromises.values())
            }
        }

        return results
    }
}
