import { Tool } from "./tool"
import z from "zod"
import { AutoDebug } from "../agent/auto-debug"

const autoDebugParameters = z.object({
    command: z.string().describe("The command to run and debug"),
    max_retries: z.number().int().default(3).describe("Maximum number of retries"),
})

export const AutoDebugTool = Tool.define("auto_debug", async (ctx) => {
    return {
        description: "Run a command and automatically debug/fix it if it fails.",
        parameters: autoDebugParameters,
        async execute(params: z.infer<typeof autoDebugParameters>, ctx) {
            const result = await AutoDebug.run(params.command, params.max_retries, ctx.sessionID)

            if (result.success) {
                return {
                    title: "Auto-Debug Success",
                    metadata: {},
                    output: `Command succeeded:\n${result.output}`,
                }
            } else {
                return {
                    title: "Auto-Debug Failed",
                    metadata: {},
                    output: `Command failed after ${params.max_retries} attempts.\nError: ${result.error || result.output}\nAnalysis: ${result.analysis ?? "None"}`,
                }
            }
        }
    }
})
