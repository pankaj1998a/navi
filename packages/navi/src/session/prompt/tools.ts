import { type Tool as AITool, jsonSchema, type ToolCallOptions } from "ai"
import { Log } from "../../util/log"
import { Agent } from "../../agent/agent"
import { Session } from ".."
import { Provider } from "../../provider/provider"
import { ProviderTransform } from "../../provider/transform"
import { SessionProcessor } from "../processor"
import { ToolRegistry } from "../../tool/registry"
import { ToolExecutor } from "../../tool/executor"
import { MCP } from "../../mcp"
import { Plugin } from "../../plugin"
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { PermissionNext } from "../../permission/next"
import { getPermissionMode, permissionsConfigCache, Permission } from "../../permission"
import { Instance } from "../../project/instance"
import { Tool } from "../../tool/tool"

const log = Log.create({ service: "session.prompt.tools" })

export async function resolveTools(input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: SessionProcessor.Info
    bypassAgentCheck: boolean
    messages: MessageV2.WithParts[]
}) {
    using _ = log.time("resolveTools")
    const tools: Record<string, AITool> = {}

    const context = (args: any, options: ToolCallOptions): Tool.Context => ({
        sessionID: input.session.id,
        abort: options.abortSignal!,
        messageID: input.processor.message.id,
        callID: options.toolCallId,
        extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
        agent: input.agent.name,
        messages: input.messages,
        metadata: async (val: { title?: string; metadata?: any }) => {
            const match = input.processor.partFromToolCall(options.toolCallId)
            if (match && match.state.status === "running") {
                await Session.updatePart({
                    ...match,
                    state: {
                        title: val.title,
                        metadata: val.metadata,
                        status: "running",
                        input: args,
                        time: {
                            start: Date.now(),
                        },
                    },
                })
            }
        },
        async ask(req) {
            const mode = getPermissionMode(input.session.id)

            // Handle global permission modes
            if ((mode as any) === "allow-all") {
                const config = permissionsConfigCache.getMergedConfig(Instance.directory)
                if (config.blockedTools.has(req.permission)) {
                    throw new Permission.RejectedError(input.session.id, req.permission, options.toolCallId, req.metadata, `Tool "${req.permission}" is explicitly blocked.`)
                }
                // In allow-all mode, skip asking unless blocked
                return
            }

            if (mode === "safe") {
                const config = permissionsConfigCache.getMergedConfig(Instance.directory)
                if (config.blockedTools.has(req.permission)) {
                    throw new Permission.RejectedError(input.session.id, req.permission, options.toolCallId, req.metadata, `Tool "${req.permission}" is blocked in Safe Mode.`)
                }
            }

            await PermissionNext.ask({
                ...req,
                sessionID: input.session.id,
                tool: { messageID: input.processor.message.id, callID: options.toolCallId },
                ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
            })
        },
    })

    for (const item of await ToolRegistry.tools(input.model.providerID, input.agent)) {
        tools[item.id] = ToolExecutor.createAITool(item, context, input.model)
    }

    const mcpToolsResult = await MCP.tools()
    const isGeminiModel = input.model.providerID === "google" ||
        input.model.providerID === "gemini-cli" ||
        input.model.api.id.toLowerCase().includes("gemini")

    for (const [key, item] of Object.entries(mcpToolsResult)) {
        const originalExecute = item.execute
        if (!originalExecute) continue

        // Apply Gemini-specific schema transformation for MCP tools
        if (isGeminiModel) {
            const originalSchema = (item as any).inputSchema?.jsonSchema || (item as any).parameters?.jsonSchema
            if (originalSchema) {
                const transformedSchema = ProviderTransform.schema(input.model, originalSchema)
                const wrapped = jsonSchema(transformedSchema as any)
                    ; (item as any).inputSchema = wrapped
                    ; (item as any).parameters = wrapped
            }
        }

        // Wrap execute to add plugin hooks and format output
        item.execute = async (args, opts) => {
            const ctx = context(args, opts)

            await Plugin.trigger("tool.execute.before", { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId }, { args })
            await ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })

            const result = await originalExecute(args, opts)

            await Plugin.trigger("tool.execute.after", { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId }, result)

            const textParts: string[] = []
            const attachments: MessageV2.FilePart[] = []

            for (const contentItem of result.content) {
                if (contentItem.type === "text") {
                    textParts.push(contentItem.text)
                } else if (contentItem.type === "image") {
                    // Handle image blocks from MCP tools
                    attachments.push({
                        id: Identifier.ascending("part"),
                        sessionID: input.session.id,
                        messageID: input.processor.message.id,
                        type: "file",
                        mime: contentItem.mimeType,
                        url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                    })
                } else if (contentItem.type === "audio") {
                    // Handle audio blocks from MCP tools (similar to image handling)
                    attachments.push({
                        id: Identifier.ascending("part"),
                        sessionID: input.session.id,
                        messageID: input.processor.message.id,
                        type: "file",
                        mime: contentItem.mimeType,
                        url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                    })
                } else if (contentItem.type === "resource") {
                    const { resource } = contentItem
                    if (resource.text) {
                        textParts.push(resource.text)
                    }
                    if (resource.blob) {
                        attachments.push({
                            id: Identifier.ascending("part"),
                            sessionID: input.session.id,
                            messageID: input.processor.message.id,
                            type: "file",
                            mime: resource.mimeType ?? "application/octet-stream",
                            url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                            filename: resource.uri,
                        })
                    }
                }
            }

            return {
                title: "",
                metadata: result.metadata ?? {},
                output: textParts.join("\n\n"),
                attachments,
                content: result.content, // directly return content to preserve ordering when outputting to model
            }
        }
        item.toModelOutput = (result) => {
            return {
                type: "text",
                value: result.output,
            }
        }
        tools[key] = item
    }

    return tools
}



