import { Log } from "../util/log"
import { spawn } from "child_process"

export interface ValidationResult {
    success: boolean
    errors: string[]
    output: string
    command: string
}

export class Validator {
    private static log = Log.create({ service: "validator" })

    static async runCheck(command: string, cwd: string): Promise<ValidationResult> {
        this.log.info("running validation check", { command, cwd })

        return new Promise((resolve) => {
            const [cmd, ...args] = command.split(" ")
            const child = spawn(cmd, args, { cwd, shell: true })

            let output = ""
            child.stdout.on("data", (data) => output += data.toString())
            child.stderr.on("data", (data) => output += data.toString())

            child.on("close", (code) => {
                const errors = code !== 0 ? this.parseErrors(output) : []
                resolve({
                    success: code === 0,
                    errors,
                    output,
                    command,
                })
            })
        })
    }

    private static parseErrors(output: string): string[] {
        // Basic error parsing - can be expanded for specific tools (tsc, eslint, etc.)
        const lines = output.split("\n")
        return lines.filter(line =>
            line.toLowerCase().includes("error") ||
            line.toLowerCase().includes("failed") ||
            line.match(/:\d+:\d+:/) // Matches typical file:line:col format
        ).slice(0, 10) // Limit to first 10 errors for context
    }

    static async validateEdits(cwd: string): Promise<ValidationResult[]> {
        const checks = [
            "bun run typecheck",
            "npm run lint"
        ]

        const results: ValidationResult[] = []
        for (const check of checks) {
            const result = await this.runCheck(check, cwd)
            results.push(result)
            if (!result.success) break // Stop at first failure
        }

        return results
    }
}
