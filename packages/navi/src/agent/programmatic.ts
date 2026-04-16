import z from "zod"
import { AgentSystem } from "./agent-system"
import { ulid } from "ulid"

/**
 * Defines the structure for a Programmatic Agent
 * This aligns with Codebuff's AgentTemplate
 */
export const AgentTemplate = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    model: z.string().optional(),
    tools: z.array(z.string()).optional().default([]),

    /**
     * Generator function that yields steps or tool calls
     * This is stored as a function at runtime, but defined here for type safety
     */
    handleSteps: z.function().optional(),

    systemPrompt: z.string().optional(),
    phase: z.enum(["analyze", "database", "interface", "test", "realize", "general", "design", "security", "deploy", "optimize", "debug", "document"]).optional(),
    skills: z.array(z.string()).optional(),
})
export type AgentTemplate = z.infer<typeof AgentTemplate> & {
    handleSteps?: (context: AgentContext) => AsyncGenerator<AgentStep, string | void, any>
}

export type AgentStep =
    | { type: "step", name: string, description?: string }
    | { type: "tool", name: string, input: any }
    | { type: "log", message: string }
    | { type: "subtask", agent: string, description: string, prompt: string }
    | { type: "finish", result: string }

export interface AgentContext {
    agentId: string
    sessionID: string
    input: string
    history: any[]
}


/**
 * Registry for Programmatic Agents
 */
export namespace AgentRegistry {
    const templates = new Map<string, AgentTemplate>()

    export function register(template: AgentTemplate) {
        templates.set(template.id, template)
    }

    export function get(id: string) {
        return templates.get(id)
    }

    export function list() {
        return Array.from(templates.values())
    }
}

/**
 * Runtime for executing Programmatic Agents
 */
export namespace ProgrammaticAgentRuntime {

    export async function execute(
        templateId: string,
        input: string,
        sessionID: string,
        toolExecutor: (name: string, input: any) => Promise<any>,
        options: {
            messageId?: string,
            emitPart?: (part: any) => Promise<void>
        } = {}
    ): Promise<string> {
        const template = AgentRegistry.get(templateId)
        if (!template) throw new Error(`Agent template ${templateId} not found`)
        if (!template.handleSteps) throw new Error(`Agent ${templateId} has no handleSteps function`)

        const context: AgentContext = {
            agentId: template.id,
            sessionID,
            input,
            history: []
        }

        const generator = template.handleSteps(context)
        let lastResult: any = undefined

        while (true) {
            const { value, done } = await generator.next(lastResult)

            if (done) {
                if (options.emitPart) {
                    await options.emitPart({
                        id: ulid(),
                        type: "step-finish",
                        reason: (value as string) || "Agent finished",
                        cost: 0,
                        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
                    })
                }
                return (value as any) || "Agent finished without result"
            }

            if (value.type === "tool") {
                const result = await toolExecutor(value.name, value.input)
                lastResult = result
            } else if (value.type === "step") {
                if (options.emitPart) {
                    await options.emitPart({
                        id: ulid(),
                        type: "step-start",
                        snapshot: value.name
                    })
                }
                console.log(`[${template.name}] Step: ${value.name}`)
            } else if (value.type === "log") {
                if (options.emitPart) {
                    await options.emitPart({
                        id: ulid(),
                        type: "text",
                        text: `> ${value.message}`,
                        metadata: { flavor: "log" }
                    })
                }
                console.log(`[${template.name}] Log: ${value.message}`)
            } else if (value.type === "finish") {
                if (options.emitPart) {
                    await options.emitPart({
                        id: ulid(),
                        type: "step-finish",
                        reason: value.result,
                        cost: 0,
                        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
                    })
                }
                return value.result
            } else if (value.type === "subtask") {
                if (options.emitPart) {
                    await options.emitPart({
                        id: ulid(),
                        type: "subtask",
                        agent: value.agent,
                        description: value.description,
                        prompt: value.prompt
                    })
                }
                // For now, we simulate subtask execution or handle it via toolExecutor if wrapped
                // In a full implementation, we might call AgentSystem.run recursively
                console.log(`[${template.name}] Spawning subtask: ${value.description} (@${value.agent})`)
            }
        }
    }
}


