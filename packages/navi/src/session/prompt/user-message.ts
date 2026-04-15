import path from "path"
import os from "os"
import fs from "fs/promises"
import { Log } from "../../util/log"
import { Agent } from "../../agent/agent"
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { MCP } from "../../mcp"
import { Instance } from "../../project/instance"
import { Session } from ".."
import { Plugin } from "../../plugin"
import {
    collectPromptTaskText,
    formatBuildAdvisorNote,
    recommendAgentMode,
    shouldInjectBuildAdvisor,
} from "../../agent/mode-advisor"
import { analyzeTaskComplexity } from "../../agent/adaptive-thinking"

const log = Log.create({ service: "session.prompt.user-message" })

export async function createUserMessage(input: any & { lastModel: (sessionID: string) => Promise<any> }) {
    const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
    const taskText = collectPromptTaskText({
        input: input.input,
        parts: input.parts,
    })
    const recommendation = taskText
        ? recommendAgentMode({
            task: taskText,
            currentAgent: agent.name,
        })
        : undefined
    const info: MessageV2.Info = {
        id: input.messageID ?? Identifier.ascending("message"),
        role: "user",
        sessionID: input.sessionID,
        time: {
            created: Date.now(),
        },
        tools: input.tools,
        agent: agent.name,
        model: input.model ?? agent.model ?? (await input.lastModel(input.sessionID)),
        system: input.system,
        variant: input.variant,
    }

    // Apply adaptive thinking if variant not explicitly set
    if (!info.variant && taskText) {
        const analysis = analyzeTaskComplexity(taskText)
        if (analysis.recommendation === "think" || analysis.recommendation === "max") {
            log.info("adaptive thinking suggestion", { recommendation: analysis.recommendation, score: analysis.score })
            info.variant = analysis.recommendation
        }
    }

    if (agent.name === "build" && recommendation && shouldInjectBuildAdvisor(recommendation)) {
        info.system = [info.system, formatBuildAdvisorNote(recommendation, taskText)]
            .filter(Boolean)
            .join("\n\n")
    }

    const parts = await Promise.all(
        input.parts.map(async (part: any): Promise<MessageV2.Part[]> => {
            if (part.type === "file") {
                // before checking the protocol we check if this is an mcp resource because it needs special handling
                if (part.source?.type === "resource") {
                    const { clientName, uri } = part.source
                    log.info("mcp resource", { clientName, uri, mime: part.mime })

                    const pieces: MessageV2.Part[] = [
                        {
                            id: Identifier.ascending("part"),
                            messageID: info.id,
                            sessionID: input.sessionID,
                            type: "text",
                            synthetic: true,
                            text: `Reading MCP resource: ${part.filename} (${uri})`,
                        },
                    ]

                    try {
                        const resourceContent = await MCP.readResource(clientName, uri)
                        if (!resourceContent) {
                            throw new Error(`Resource not found: ${clientName}/${uri}`)
                        }

                        // Handle different content types
                        const contents = Array.isArray(resourceContent.contents)
                            ? resourceContent.contents
                            : [resourceContent.contents]

                        for (const content of contents) {
                            if ('text' in content && content.text) {
                                pieces.push({
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "text",
                                    text: content.text,
                                })
                            } else if ('blob' in content && content.blob) {
                                pieces.push({
                                    id: Identifier.ascending("part"),
                                    messageID: info.id,
                                    sessionID: input.sessionID,
                                    type: "file",
                                    url: `data:${content.mimeType};base64,${content.blob}`,
                                    filename: part.filename ?? "unknown",
                                    mime: content.mimeType ?? "application/octet-stream",
                                })
                            }
                        }
                        return pieces
                    } catch (error) {
                        log.error("failed to read mcp resource", { error, clientName, uri })
                        return [
                            ...pieces,
                            {
                                id: Identifier.ascending("part"),
                                messageID: info.id,
                                sessionID: input.sessionID,
                                type: "text",
                                synthetic: true,
                                text: `Error reading resource: ${error instanceof Error ? error.message : String(error)}`,
                            },
                        ]
                    }
                }

                if (part.url && part.url.startsWith("file://")) {
                    const filepath = part.url.slice(7)
                    log.info("reading file", { filepath })
                    const stats = await fs.stat(filepath).catch(() => undefined)
                    if (!stats) {
                        return [
                            {
                                id: Identifier.ascending("part"),
                                messageID: info.id,
                                sessionID: input.sessionID,
                                type: "text",
                                text: `File not found: ${part.filename} (${filepath})`,
                                synthetic: true,
                            },
                        ]
                    }

                    if (stats.isDirectory()) {
                        const files = await fs.readdir(filepath)
                        return [
                            {
                                id: Identifier.ascending("part"),
                                messageID: info.id,
                                sessionID: input.sessionID,
                                type: "text",
                                text: `Directory: ${part.filename} (${filepath})\n\nFiles:\n${files.join("\n")}`,
                                synthetic: true,
                            },
                        ]
                    }

                    const content = await fs.readFile(filepath, "utf-8")
                    return [
                        {
                            id: Identifier.ascending("part"),
                            messageID: info.id,
                            sessionID: input.sessionID,
                            type: "text",
                            text: `File: ${part.filename} (${filepath})\n\n\`\`\`\n${content}\n\`\`\``,
                            synthetic: true,
                        },
                    ]
                }
            }

            if (part.type === "agent") {
                const agent = await Agent.get(part.name)
                if (agent) {
                    return [
                        {
                            id: Identifier.ascending("part"),
                            messageID: info.id,
                            sessionID: input.sessionID,
                            type: "text",
                            text: `Invoking agent: ${agent.name}`,
                            synthetic: true,
                        },
                    ]
                }
            }

            const p: MessageV2.Part = {
                ...part,
                id: part.id ?? Identifier.ascending("part"),
                messageID: info.id,
                sessionID: input.sessionID,
            }
            return [p]
        }),
    ).then((x) => x.flat())

    // Trigger plugin hook
    await Plugin.trigger(
        "chat.message",
        {
            sessionID: input.sessionID,
            agent: input.agent,
            model: input.model,
            messageID: input.messageID,
            variant: input.variant,
        },
        {
            message: info,
            parts,
        },
    )

    // Persist message and parts to the session store
    await Session.updateMessage(info)
    for (const part of parts) {
        await Session.updatePart(part)
    }

    return {
        info,
        parts,
    }
}




