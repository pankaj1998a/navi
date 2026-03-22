import { tool, jsonSchema } from "ai"
import { Tool } from "./tool"
import { ProviderTransform } from "../provider/transform"
import { Plugin } from "../plugin"
import z from "zod"
import type { Provider } from "../provider/provider"

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
            inputSchema: jsonSchema(schema as any),
            async execute(args, options) {
                const ctx = contextFactory(args, options)

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
                    const result = await item.execute(args, ctx)

                    await Plugin.trigger(
                        "tool.execute.after",
                        {
                            tool: item.id,
                            sessionID: ctx.sessionID,
                            callID: ctx.callID,
                        },
                        result,
                    )

                    return result
                } catch (error) {
                    throw error
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
