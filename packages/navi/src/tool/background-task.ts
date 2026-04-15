/**
 * Background Task Tool for Navi
 *
 * Spawns agent tasks that run asynchronously in the background,
 * allowing parallel execution of multiple exploration/research tasks.
 *
 * Ported from oh-my-navi-dev sisyphus_task with background=true
 */

import { Tool } from "./tool"
import DESCRIPTION from "./background-task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { canSpawnAgent, filterSpawnableAgents } from "../agent/spawn"

const log = Log.create({ service: "background-task" })

const parameters = z.object({
    description: z.string().describe("A short (3-5 words) description of the task"),
    prompt: z.string().describe("The task for the agent to perform"),
    agent: z.string().describe("The type of specialized agent to use for this task"),
})

// Track running background tasks
interface BackgroundTask {
    id: string
    sessionID: string
    agent: string
    description: string
    status: "running" | "completed" | "failed" | "cancelled"
    startedAt: number
    completedAt?: number
    result?: string
    error?: string
}

const backgroundTasks = new Map<string, BackgroundTask>()

/**
 * Get a background task by ID
 */
export function getBackgroundTask(taskId: string): BackgroundTask | undefined {
    return backgroundTasks.get(taskId)
}

/**
 * Get all background tasks for a parent session
 */
export function getBackgroundTasksByParent(parentSessionID: string): BackgroundTask[] {
    return Array.from(backgroundTasks.values()).filter((task) =>
        task.id.startsWith(parentSessionID.slice(0, 8))
    )
}

/**
 * Cancel a background task
 */
export function cancelBackgroundTask(taskId: string): boolean {
    const task = backgroundTasks.get(taskId)
    if (!task || task.status !== "running") return false

    SessionPrompt.cancel(task.sessionID)
    task.status = "cancelled"
    task.completedAt = Date.now()
    return true
}

export const BackgroundTaskTool = Tool.define("background_task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  const caller = ctx?.agent
  const accessibleAgents = filterSpawnableAgents(caller, agents)

    const description = DESCRIPTION.replace(
        "{agents}",
        accessibleAgents.map((a) => `- ${a.name}: ${a.description ?? "No description"}`).join("\n")
    )

    return {
        description,
        parameters,
        async execute(params: z.infer<typeof parameters>, ctx) {
            const config = await Config.get()

            // Check task permission
            await ctx.ask({
                permission: "task",
                patterns: [params.agent],
                always: ["*"],
                metadata: {
                    description: params.description,
                    agent: params.agent,
                    background: true,
                },
            })

            const agent = await Agent.get(params.agent)
            if (!agent) throw new Error(`Unknown agent type: ${params.agent}`)
            if (!canSpawnAgent(caller, agent.name)) {
                throw new Error(`Agent "${agent.name}" is not available to "${caller?.name ?? "this agent"}"`)
            }

            // Create a task ID using session identifier type
            const taskId = Identifier.ascending("session")

            // Create session for background task
            const session = await Session.create({
                parentID: ctx.sessionID,
                title: `[BG] ${params.description} (@${agent.name})`,
                permission: [
                    { permission: "todowrite", pattern: "*", action: "deny" },
                    { permission: "todoread", pattern: "*", action: "deny" },
                    { permission: "task", pattern: "*", action: "deny" },
                ],
            })

            // Register the background task
            const task: BackgroundTask = {
                id: taskId,
                sessionID: session.id,
                agent: params.agent,
                description: params.description,
                status: "running",
                startedAt: Date.now(),
            }
            backgroundTasks.set(taskId, task)

            log.info("Background task started", { taskId, sessionID: session.id, agent: params.agent })

            // Start the task asynchronously (don't await)
            const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
            if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

            const model = agent.model ?? {
                modelID: msg.info.modelID,
                providerID: msg.info.providerID,
            }

            const messageID = Identifier.ascending("message")
            const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

            // Run in background
            SessionPrompt.prompt({
                messageID,
                sessionID: session.id,
                model: {
                    modelID: model.modelID,
                    providerID: model.providerID,
                },
                agent: agent.name,
                tools: {
                    todowrite: false,
                    todoread: false,
                    task: false,
                    background_task: false,
                },
                parts: promptParts,
            })
                .then(async (result) => {
                    const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
                    task.status = "completed"
                    task.completedAt = Date.now()
                    task.result = text
                    log.info("Background task completed", { taskId, sessionID: session.id })
                })
                .catch((error) => {
                    task.status = "failed"
                    task.completedAt = Date.now()
                    task.error = error instanceof Error ? error.message : String(error)
                    log.warn("Background task failed", { taskId, sessionID: session.id, error: task.error })
                })

            // Return immediately with task ID
            return {
                title: `Started: ${params.description}`,
                metadata: {
                    taskId,
                    sessionID: session.id,
                    agent: params.agent,
                    status: "running",
                },
                output: `Background task started.

<background_task>
task_id: ${taskId}
session_id: ${session.id}
agent: ${params.agent}
status: running
</background_task>

Use \`background_output(task_id="${taskId}")\` to check results when needed.
Continue with other work - this task runs in parallel.`,
            }
        },
    }
})

// Tool to get background task output
const outputParameters = z.object({
    task_id: z.string().describe("The task_id from a previous background_task call"),
})

export const BackgroundOutputTool = Tool.define("background_output", async () => {
    return {
        description:
            "Get the output of a background task. Use after launching a background_task to retrieve results.",
        parameters: outputParameters,
        async execute(params: z.infer<typeof outputParameters>, ctx) {
            const task = backgroundTasks.get(params.task_id)

            if (!task) {
                return {
                    title: "Task not found",
                    metadata: {} as any,
                    output: `No background task found with ID: ${params.task_id}`,
                }
            }

            if (task.status === "running") {
                const elapsed = Math.round((Date.now() - task.startedAt) / 1000)
                return {
                    title: `Running: ${task.description}`,
                    metadata: { status: "running", elapsed: `${elapsed}s` } as any,
                    output: `Task is still running (${elapsed}s elapsed).

<background_task>
task_id: ${task.id}
agent: ${task.agent}
status: running
elapsed: ${elapsed}s
</background_task>

Check again later with \`background_output(task_id="${task.id}")\``,
                }
            }

            if (task.status === "completed") {
                const duration = task.completedAt
                    ? Math.round((task.completedAt - task.startedAt) / 1000)
                    : 0
                return {
                    title: `Completed: ${task.description}`,
                    metadata: { status: "completed", duration: `${duration}s` } as any,
                    output: `Task completed in ${duration}s.

<background_task_result>
task_id: ${task.id}
agent: ${task.agent}
status: completed
</background_task_result>

${task.result ?? "(no output)"}`,
                }
            }

            if (task.status === "failed") {
                return {
                    title: `Failed: ${task.description}`,
                    metadata: { status: "failed" } as any,
                    output: `Task failed: ${task.error ?? "Unknown error"}`,
                }
            }

            if (task.status === "cancelled") {
                return {
                    title: `Cancelled: ${task.description}`,
                    metadata: { status: "cancelled" } as any,
                    output: `Task was cancelled.`,
                }
            }

            return {
                title: task.description,
                metadata: { status: task.status } as any,
                output: `Task status: ${task.status}`,
            }
        },
    }
})

// Tool to cancel background tasks
const cancelParameters = z.object({
    task_id: z.string().describe("The task_id of the background task to cancel"),
})

export const BackgroundCancelTool = Tool.define("background_cancel", async () => {
    return {
        description: "Cancel a running background task.",
        parameters: cancelParameters,
        async execute(params: z.infer<typeof cancelParameters>, ctx) {
            const success = cancelBackgroundTask(params.task_id)

            if (success) {
                return {
                    title: "Task cancelled",
                    metadata: {},
                    output: `Background task ${params.task_id} has been cancelled.`,
                }
            }

            const task = backgroundTasks.get(params.task_id)
            if (task) {
                return {
                    title: "Cannot cancel",
                    metadata: {},
                    output: `Task ${params.task_id} is already ${task.status}.`,
                }
            }

            return {
                title: "Task not found",
                metadata: {},
                output: `No background task found with ID: ${params.task_id}`,
            }
        },
    }
})


