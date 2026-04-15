import z from "zod"
import { Tool } from "./tool"
import { spawn } from "child_process"

const INTERACTIVE_BASH_DESCRIPTION = `Execute tmux commands to manage persistent terminal sessions.
This tool allows you to run long-running processes, attach to existing sessions, and capture terminal output.
Always use 'tmux' commands without the 'tmux' prefix.
Example: 'new-session -s my-session -d "npm run dev"'`

export const InteractiveBashTool = Tool.define("interactive_bash", {
    description: INTERACTIVE_BASH_DESCRIPTION,
    parameters: z.object({
        tmux_command: z.string().describe("The tmux command to execute (without 'tmux' prefix)"),
    }),
    execute: async (args, ctx) => {
        const parts = args.tmux_command.split(/\s+/)
        if (parts.length === 0) {
            return {
                title: "Interactive Bash",
                metadata: { exitCode: 1 },
                output: "Error: Empty tmux command",
            }
        }

        return new Promise<{ title: string; metadata: { exitCode?: number | null }; output: string }>((resolve) => {
            const proc = spawn("tmux", parts, {
                shell: true,
                env: process.env,
            })

            let stdout = ""
            let stderr = ""

            proc.stdout?.on("data", (data) => {
                stdout += data.toString()
            })

            proc.stderr?.on("data", (data) => {
                stderr += data.toString()
            })

            proc.on("close", (code) => {
                if (code !== 0) {
                    resolve({
                        title: `Interactive Bash: ${args.tmux_command}`,
                        metadata: { exitCode: code },
                        output: stderr || `Command failed with exit code ${code}`,
                    })
                } else {
                    resolve({
                        title: `Interactive Bash: ${args.tmux_command}`,
                        metadata: { exitCode: code },
                        output: stdout || "(no output)",
                    })
                }
            })

            proc.on("error", (err) => {
                resolve({
                    title: "Error",
                    metadata: { exitCode: 1 },
                    output: `Failed to spawn tmux: ${err.message}`,
                })
            })

            // Timeout after 30 seconds
            setTimeout(() => {
                proc.kill()
                resolve({
                    title: "Timeout",
                    metadata: { exitCode: 124 },
                    output: "Tmux command timed out after 30s",
                })
            }, 30000)
        })
    },
})


