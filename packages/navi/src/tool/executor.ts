import { tool, jsonSchema } from "ai"
import { Tool } from "./tool"
import { ProviderTransform } from "../provider/transform"
import { Plugin } from "../plugin"
import { Config } from "../config/config"
import z from "zod"
import type { Provider } from "../provider/provider"
import type { JSONSchema7 } from "@ai-sdk/provider"

export class ToolExecutor {
    static createAITool(
        item: {
            id: string
            description: string
            parameters: z.ZodType
            execute: (args: any, ctx: Tool.Context) => Promise<any>
        },
        contextFactory: (args: any, options: any) => Tool.Context,
        model: Provider.Model
    ) {
        const schema = ProviderTransform.schema(model, z.toJSONSchema(item.parameters))

        return tool({
            id: item.id as any,
            description: item.description,
            inputSchema: jsonSchema(schema as JSONSchema7),
            async execute(args, options) {
                const ctx = contextFactory(args, options)
                const config = await Config.get()
                const timeoutMs = config.experimental?.mcp_timeout ?? 60000

                // Combined abort signal for context abort and timeout
                const timeoutController = new AbortController()
                const timeoutTimer = setTimeout(() => {
                    timeoutController.abort(new Error(`Tool execution timed out after ${timeoutMs}ms`))
                }, timeoutMs)

                const signal = AbortSignal.any([ctx.abort, timeoutController.signal])
                
                // Update context with the combined signal
                const toolCtx = { ...ctx, abort: signal }

                await Plugin.trigger(
                    "tool.execute.before",
                    {
                        tool: item.id,
                        sessionID: ctx.sessionID,
                        callID: ctx.callID,
                    },
                    {
                        args,
                    },
                )

                try {
                    const result = await item.execute(args, toolCtx)

                    await Plugin.trigger(
                        "tool.execute.after",
                        {
                            tool: item.id,
                            sessionID: ctx.sessionID,
                            callID: ctx.callID,
                            args: args,
                        },
                        result,
                    )

                    return result
                } catch (error) {
                    await Plugin.trigger(
                        "tool.execute.error",
                        {
                            tool: item.id,
                            sessionID: ctx.sessionID,
                            callID: ctx.callID,
                        },
                        { error: error instanceof Error ? error.message : String(error) },
                    )
                    throw error
                } finally {
                    clearTimeout(timeoutTimer)
                }
            },
            // @ts-ignore
            toModelOutput(result) {
                return {
                    type: "text",
                    value: result.output,
                }
            },
        })
    }
}


