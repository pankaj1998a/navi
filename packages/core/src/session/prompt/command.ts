import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { Log } from "../../util/log"
import { Session } from ".."
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { Command } from "../../command"
import { ConfigMarkdown } from "../../config/markdown"
import { Bus } from "../../bus"
import { NamedError } from "@navi-ai/sdk/util/error"
import { $ } from "bun"
import { iife } from "../../util/iife"
import { Storage } from "../../storage/storage"
import { Instance } from "../../project/instance"
import z from "zod"
import { ProviderID, ModelID } from "../../provider/schema"
import { MessageID, SessionID, PartID } from "../../session/schema"

const log = Log.create({ service: "session.prompt.command" })

export const CommandInput = z.object({
    messageID: Identifier.schema("message").optional(),
    sessionID: Identifier.schema("session"),
    agent: z.string().optional(),
    model: z.string().optional(),
    arguments: z.string(),
    command: z.string(),
    variant: z.string().optional(),
    parts: z
        .array(
            z.discriminatedUnion("type", [
                MessageV2.FilePart.omit({
                    messageID: true,
                    sessionID: true,
                }).partial({
                    id: true,
                }),
            ]),
        )
        .optional(),
})
export type CommandInput = z.infer<typeof CommandInput>

const bashRegex = /!`([^`]+)`/g
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export async function executeCommand(input: CommandInput, deps: {
    prompt: (input: any) => Promise<MessageV2.WithParts | void>
    lastModel: (sessionID: string) => Promise<{ providerID: string; modelID: string }>
    resolvePromptParts: (text: string) => Promise<any[]>
}) {
    log.info("command", input)
    const command = await Command.get(input.command)
    if (!command) {
        throw new Error(`Command not found: ${input.command}`)
    }
    const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())

    const raw = input.arguments.match(argsRegex) ?? []
    const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

    const templateCommand = await command.template

    const placeholders = templateCommand.match(placeholderRegex) ?? []
    let last = 0
    for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
    }

    const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
    })
    let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

    const shell = ConfigMarkdown.shell(template)
    if (shell.length > 0) {
        const results = await Promise.all(
            shell.map(async ([, cmd]) => {
                try {
                    return await $`${{ raw: cmd }}`.quiet().nothrow().text()
                } catch (error) {
                    return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
                }
            }),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
    }
    template = template.trim()

    const model = await (async () => {
        if (command.model) {
            return Provider.parseModel(command.model)
        }
        if (command.agent) {
            const cmdAgent = await Agent.get(command.agent)
            if (cmdAgent?.model) {
                return cmdAgent.model
            }
        }
        if (input.model) return Provider.parseModel(input.model)
        return await deps.lastModel(input.sessionID)
    })()

    try {
        await Provider.getModel(ProviderID.make(model.providerID), ModelID.make(model.modelID))
    } catch (e) {
        if (Provider.ModelNotFoundError.isInstance(e)) {
            const { providerID, modelID, suggestions } = e.data
            const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
            Bus.publish(Session.Event.Error, {
                sessionID: SessionID.make(input.sessionID),
                error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
            })
        }
        throw e
    }
    const agent = await Agent.get(agentName)
    if (!agent) {
        const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        Bus.publish(Session.Event.Error, {
            sessionID: SessionID.make(input.sessionID),
            error: error.toObject(),
        })
        throw error
    }

    const templateParts = await deps.resolvePromptParts(template)
    const parts =
        (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
            ? [
                {
                    type: "subtask" as const,
                    agent: agent.name,
                    description: command.description ?? "",
                    command: input.command,
                    prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
                },
            ]
            : ([...templateParts, ...(input.parts ?? [])] as MessageV2.Part[])

    // Native Handler Interception
    if ((command as any).handler) {
        log.info("executing native handler", { command: input.command })
        const handlerResult = await (command as any).handler(input.arguments, input.sessionID)
        
        // 1. Ensure User Message exists
        let userMessageID = input.messageID
        if (!userMessageID) {
            userMessageID = Identifier.ascending("message")
            const userMsg: MessageV2.User = {
                id: MessageID.make(userMessageID),
                sessionID: SessionID.make(input.sessionID),
                role: "user",
                time: { created: Date.now() },
                agent: agentName,
                model: {
                    providerID: ProviderID.make(model.providerID),
                    modelID: ModelID.make(model.modelID)
                },
                variant: input.variant,
            }
            await Session.updateMessage(userMsg)
            
            // Write text parts for the user command
            for (const part of parts) {
                const partID = Identifier.ascending("part")
                await Session.updatePart({
                    ...part,
                    id: PartID.make(partID),
                    messageID: MessageID.make(userMessageID),
                    sessionID: SessionID.make(input.sessionID),
                } as MessageV2.Part)
            }
            Bus.publish(Session.Event.Updated, { sessionID: SessionID.make(input.sessionID), info: await Session.get(SessionID.make(input.sessionID)) })
        }

        // 2. Create Assistant Response
        const assistantMessageID = MessageID.make(Identifier.ascending("message"))
        const assistantMsg: MessageV2.Assistant = {
            id: assistantMessageID,
            sessionID: SessionID.make(input.sessionID),
            role: "assistant",
            parentID: MessageID.make(userMessageID),
            time: { created: Date.now(), completed: Date.now() },
            modelID: ModelID.make(model.modelID),
            providerID: ProviderID.make(model.providerID),
            agent: agentName,
            mode: agent.mode,
            path: { cwd: process.cwd(), root: Instance.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
        await Session.updateMessage(assistantMsg)
        
        const responsePartID = PartID.make(Identifier.ascending("part"))
        const responsePart: MessageV2.TextPart = {
            id: responsePartID,
            messageID: assistantMessageID,
            sessionID: SessionID.make(input.sessionID),
            type: "text",
            text: handlerResult,
        }
        await Session.updatePart(responsePart)

        const result: MessageV2.WithParts = {
            info: assistantMsg,
            parts: [responsePart],
        }

        Bus.publish(Command.Event.Executed, {
            name: input.command,
            sessionID: SessionID.make(input.sessionID),
            arguments: input.arguments,
            messageID: result.info.id,
        })

        return result
    }

    const result = (await deps.prompt({
        sessionID: SessionID.make(input.sessionID),
        messageID: input.messageID ? MessageID.make(input.messageID) : undefined,
        model: {
            providerID: ProviderID.make(model.providerID),
            modelID: ModelID.make(model.modelID)
        },
        agent: agentName,
        parts,
        variant: input.variant,
    })) as MessageV2.WithParts

    Bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: SessionID.make(input.sessionID),
        arguments: input.arguments,
        messageID: result.info.id,
    })

    return result
}



