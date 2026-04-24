import z from "zod"
import { Tool } from "./tool"
import { Agent } from "../agent/agent"
import { AgentSystem } from "../agent/agent-system"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import { iife } from "@/util/iife"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { canSpawnAgent, filterSpawnableAgents } from "../agent/spawn"

const log = Log.create({ service: "tool:swarm" })

const parameters = z.object({
    description: z.string().describe("Overall goal of the swarm execution"),
    tasks: z.array(z.object({
        agent_type: z.string().describe("Specialized agent for this task (e.g., 'frontend', 'backend', 'tester')"),
        model: z.string().optional().describe("Optional identifier for a specific model (e.g., 'anthropic/claude-3-5-sonnet') to use instead of the agent's default."),
        prompt: z.string().describe("Task description for the agent"),
        metadata: z.record(z.string(), z.any()).optional(),
    })).describe("List of tasks to execute in parallel"),
    iterations: z.number().int().positive().default(1).describe("Number of times to repeat the batch if verification fails (Ralph Loop)"),
    verification_command: z.string().optional().describe("Command to run after each batch to verify progress (e.g., 'npm test')"),
})

export const SwarmTool = Tool.define("swarm", {
    description: `Orchestrate a swarm of agents to work in parallel.
This implements the "Ralph Loop" philosophy: persistent iteration until verified completion.
Use this to break large features into parallelizable subtasks and ensure they pass quality checks.`,
    parameters,
    async execute(params, ctx) {
        const agents = await Agent.list().then(x => x.filter(a => a.mode === "subagent"))
        const callerName = ctx?.agent
        const caller = callerName ? await Agent.get(callerName).catch(() => undefined) : undefined
        const accessibleAgents = filterSpawnableAgents(caller ?? undefined, agents)

        log.info("Starting swarm", { description: params.description, taskCount: params.tasks.length })

        for (const task of params.tasks) {
            if (!accessibleAgents.some((agent) => agent.name === task.agent_type)) {
                throw new Error(`Agent "${task.agent_type}" is not available to "${callerName ?? "this agent"}"`)
            }
        }

        await ctx.ask({
            permission: "task",
            patterns: params.tasks.map(t => t.agent_type),
            always: ["*"],
            metadata: {
                description: params.description,
                tasks: params.tasks.length
            }
        })

        const runBatch = async (iteration: number, failureLog?: string) => {
            const taskObjects = params.tasks.map(t => {
                const canSpawn = caller ? canSpawnAgent(caller, t.agent_type) : true
                if (!canSpawn) {
                    throw new Error(`Agent "${t.agent_type}" is not available to "${callerName ?? "this agent"}"`)
                }
                
                // Adaptive Prompting: feedback failure into the next try
                const enhancedPrompt = iteration > 1 && failureLog
                    ? `[RETRY ATTEMPT ${iteration}]\nYour previous attempt failed with the following feedback:\n${failureLog}\n\nOriginal Task: ${t.prompt}`
                    : t.prompt

                return AgentSystem.createTask(t.agent_type, enhancedPrompt, { 
                    metadata: t.metadata, 
                    model: t.model 
                })
            })

            const batch = AgentSystem.createBatch(taskObjects, {
                mode: "parallel",
                maxConcurrent: 5,
                emitPart: (ctx.metadata as any) ?? {}
            })

            const executor = async (task: AgentSystem.Task): Promise<string> => {
                const agent = await Agent.get(task.agentName)
                if (!agent) throw new Error(`Swarm: Agent not found: "${task.agentName}"`)

                const session = await Session.create({
                    parentID: ctx.sessionID,
                    title: `Swarm: ${task.agentName} (Iter ${iteration})`,
                })

                // MODEL PROMOTION: If this is a retry, use a "premium" model if configured
                let selectedModel = task.model ? Provider.parseModel(task.model) : agent.model
                if (iteration > 2 && !task.model) {
                    const generalAgent = await Agent.get("general")
                    if (generalAgent?.model) {
                        log.info(`Promoting task "${task.agentName}" to premium model for stability.`, { from: selectedModel?.modelID, to: generalAgent.model.modelID })
                        selectedModel = generalAgent.model as any
                    }
                }

                const messageID = Identifier.ascending("message") as any
                const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)

                const result = await SessionPrompt.prompt({
                    messageID,
                    sessionID: session.id,
                    model: selectedModel as any,
                    agent: agent.name,
                    parts: promptParts,
                }).catch((err: Error) => {
                    const msg = err?.message ?? String(err)
                    if (msg.includes("fetch") || msg.includes("connect") || msg.includes("limit")) {
                        throw new Error(`Swarm [NETWORK/LIMIT ERROR]: ${msg}`)
                    }
                    throw new Error(`Swarm (${task.agentName}): ${msg}`)
                })

                const textPart = result.parts.findLast((x: any) => x.type === "text")
                const text = textPart && 'text' in textPart ? (textPart as any).text : ""
                return text
            }

            const completedBatch = await AgentSystem.execute(batch, executor)
            return completedBatch
        }

        let currentIteration = 0
        let lastResult = ""
        let success = false
        let failureFeedback = ""

        while (currentIteration < params.iterations && !success) {
            currentIteration++
            log.info(`Swarm iteration ${currentIteration}/${params.iterations}`)

            const batchResult = await runBatch(currentIteration, failureFeedback)
            lastResult = AgentSystem.aggregateResults(batchResult.tasks)

            if (params.verification_command) {
                const { BashTool } = await import("./bash")
                const bash = await BashTool.init({ agent: (await Agent.get(ctx.agent)) ?? undefined })
                const verifyOutput = await bash.execute({
                    command: params.verification_command,
                    description: `Verifying iteration ${currentIteration}`
                }, ctx)

                const outputLower = verifyOutput.output.toLowerCase()
                if (outputLower.includes("success") || (outputLower.includes("pass") && !outputLower.includes("fail"))) {
                    success = true
                } else {
                    log.warn("Verification failed, preparing next iteration...", { iteration: currentIteration })
                    failureFeedback = verifyOutput.output // Feed this into the next iteration
                }
            } else {
                success = true
            }
        }

        return {
            title: `Swarm: ${params.description} (${success ? 'SUCCESS' : 'FINISHED'})`,
            output: lastResult,
            metadata: {
                iterations: currentIteration,
                success,
                verification: failureFeedback || "None"
            }
        }
    }
})


