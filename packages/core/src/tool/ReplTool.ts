import z from "zod"
import { Tool } from "./tool"
import { $ } from "bun"
import { Log } from "../util/log"
import { Instance } from "../project/instance"

const log = Log.create({ service: "repl-tool" })

/**
 * ReplTool provides a sandboxed environment for executing TypeScript/JavaScript snippets.
 * This is useful for testing algorithms, verifying library behavior, or running 
 * one-off data processing tasks without polluting the filesystem.
 */
export const ReplTool = Tool.define("repl", async () => {
    return {
        description: "Executes a snippet of TypeScript or JavaScript code and returns the result/output. Use this for quick calculations, testing logic, or inspecting data structures.",
        parameters: z.object({
            code: z.string().describe("The TypeScript/JavaScript code to execute"),
            language: z.enum(["typescript", "javascript"]).default("typescript").describe("The language of the code snippet")
        }),
        async execute(params, ctx) {
            log.info("Executing REPL snippet", { lang: params.language })

            // Ensure we are allowed to run code (using 'bash' permission as a proxy for execution)
            await ctx.ask({
                permission: "bash",
                patterns: ["repl-execution"],
                always: ["repl-execution"],
                metadata: {
                    summary: "Execute a transient code snippet in the REPL",
                    code: params.code
                }
            })

            try {
                // We use 'bun eval' to run the code. 
                // This handles TS natively and runs in a separate process for basic isolation.
                const result = await $`bun eval ${params.code}`
                    .cwd(Instance.directory)
                    .quiet()
                    .nothrow()

                const output = result.stdout.toString()
                const error = result.stderr.toString()

                if (result.exitCode !== 0) {
                    return {
                        title: "REPL Execution Failed",
                        output: `ERROR:\n${error}\n\nSTDOUT:\n${output}`,
                        metadata: { exitCode: result.exitCode, error: true }
                    }
                }

                return {
                    title: "REPL Execution Successful",
                    output: output || "Code executed successfully with no output.",
                    metadata: { exitCode: 0, error: false }
                }
            } catch (err) {
                log.error("REPL execution error", { err })
                return {
                    title: "REPL Internal Error",
                    output: String(err),
                    metadata: { exitCode: 1, error: true }
                }
            }
        }
    }
})


