import { AgentSystem } from "./agent-system"
import { ulid } from "ulid"
import { Registry, type AgentDefinition } from "./registry"

/**
 * Maps a programmatic AgentTemplate to a Registry AgentDefinition
 */
function mapTemplateToDefinition(template: AgentTemplate): AgentDefinition {
    return {
        id: template.id,
        displayName: template.name,
        description: template.description,
        model: template.model || "Navi/big-pickle",
        toolNames: template.tools || [],
        instructionsPrompt: template.systemPrompt || (
            `You are the ${template.name} agent. Your phase is ${template.phase}.` +
            (template.skills.length > 0 ? `\n\nYou possess the following specialized skills: ${template.skills.join(", ")}.` : "")
        ),
        handleSteps: template.handleSteps,
        version: "1.0.0",
        publisher: "system",
        categories: [template.phase, ...template.skills],
        hidden: false,
    }
}

export type AgentTemplate = {
    id: string
    name: string
    description: string
    model?: string
    tools?: string[]
    handleSteps?: (context: AgentContext) => AsyncGenerator<AgentStep, string | void, any>
    systemPrompt?: string
    phase: "analyze" | "database" | "interface" | "test" | "realize" | "general" | "design" | "security" | "deploy" | "optimize" | "debug" | "document"
    skills: string[]
}

export type AgentStep =
    | { type: "step", name: string, description?: string }
    | { type: "tool", name: string, input: Record<string, unknown> }
    | { type: "log", message: string }
    | { type: "subtask", agent: string, description: string, prompt: string }
    | { type: "finish", result: string }

export interface AgentContext {
    agentId: string
    sessionID: string
    input: string
    history: unknown[]
}


/**
 * Registry for Programmatic Agents
 */
export namespace AgentRegistry {
    export function register(template: AgentTemplate) {
        Registry.registerStatic(mapTemplateToDefinition(template))
    }

    export function get(id: string): AgentTemplate | undefined {
        const def = Registry.getSync(id)
        if (!def) return undefined
        
        // Map back to Template if needed by callers
        return {
            id: def.id,
            name: def.displayName,
            description: def.description || "",
            model: typeof def.model === 'string' ? def.model : undefined,
            tools: def.toolNames,
            handleSteps: def.handleSteps as any,
            systemPrompt: def.instructionsPrompt,
            phase: (def.categories?.[0] as any) || "general",
            skills: def.categories?.slice(1) || []
        }
    }

    export function list(): AgentTemplate[] {
        // Implementation if needed
        return []
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
        toolExecutor: (name: string, input: Record<string, unknown>) => Promise<unknown>,
        options: {
            messageId?: string,
            emitPart?: (part: unknown) => Promise<void>
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
        let lastResult: unknown = undefined

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


