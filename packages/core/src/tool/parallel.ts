
import { Tool } from "./tool"
import z from "zod"
import { ParallelAgent } from "../agent/parallel"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { SessionID, MessageID } from "../session/schema"

const taskSchema = z.object({
    agent: z.string().describe("The name of the agent to use"),
    prompt: z.string().describe("The prompt/task for the agent"),
    priority: z.number().optional().describe("Priority of the task (higher is more important)"),
})

const parameters = z.object({
    tasks: z.array(taskSchema).describe("List of tasks to execute in parallel"),
    concurrency: z.number().optional().describe("Maximum number of concurrent agents (default: 4)"),
})

export const ParallelTool = Tool.define("parallel", async (ctx) => {
    return {
        description: "Execute multiple agent tasks in parallel. Use this when you have independent tasks that can be run simultaneously to save time.",
        parameters,
        async execute(params: z.infer<typeof parameters>, ctx) {
            const config = await Config.get()

            // Executor function that adapts ParallelAgent.Task to Navi's Session system
            const executor = async (task: ParallelAgent.Task): Promise<string> => {
                const agentName = task.agentName
                const agent = await Agent.get(agentName)
                if (!agent) throw new Error(`Unknown agent: ${agentName}`)

                // Validate that the agent can be run in parallel
                // Primary agents are typically interactive/stateful and shouldn't be run in parallel batches
                if (agent.mode === "primary") {
                    throw new Error(`Agent '${agentName}' is a primary agent and cannot be run in parallel. Use a subagent or parallel agent instead.`)
                }

                // Create a sub-session for this task
                const session = await Session.create({
                    parentID: SessionID.make(ctx.sessionID),
                    title: `Parallel Task: ${task.prompt.slice(0, 50)}... (@${agentName})`,
                    permission: PermissionNext.merge(
                        PermissionNext.fromConfig(config.permission ?? {}),
                        // Add specific permissions if needed
                    )
                })

                // Execute the prompt in the sub-session
                const messageID = MessageID.make(Identifier.ascending("message"))
                const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)

                const result = await SessionPrompt.prompt({
                    messageID,
                    sessionID: session.id,
                    model: task.model ? Provider.parseModel(task.model) : agent.model ? {
                        modelID: agent.model.modelID,
                        providerID: agent.model.providerID,
                    } : undefined,
                    agent: agentName,
                    parts: promptParts,
                }).catch((err: Error) => {
                    const msg = err?.message ?? String(err)
                    if (msg.includes("fetch") || msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
                        throw new Error(`Parallel (${agentName}): Cannot reach AI provider. Check your model/provider configuration and internet connection. Details: ${msg}`)
                    }
                    throw new Error(`Parallel (${agentName}): ${msg}`)
                })

                const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
                return text
            }

            // Run the parallel batch
            const { results, aggregated } = await ParallelAgent.runParallel(
                params.tasks.map(t => ({
                    agent: t.agent,
                    prompt: t.prompt,
                    priority: t.priority
                })),
                executor,
                {
                    maxConcurrent: params.concurrency
                }
            )

            return {
                title: "Parallel Execution Results",
                output: aggregated,
                metadata: {
                    results
                }
            }
        }
    }
})


