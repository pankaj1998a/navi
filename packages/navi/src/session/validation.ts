import { $ } from "bun"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import fs from "fs/promises"
import path from "path"

const log = Log.create({ service: "session.validation" })

export namespace SessionValidation {
    export type ValidationResult = {
        success: boolean
        error?: string
        command?: string
        output?: string
    }

    export async function validate(sessionID: string): Promise<ValidationResult[]> {
        const results: ValidationResult[] = []

        // 1. TypeScript Validation
        if (await exists(path.join(Instance.directory, "tsconfig.json"))) {
            log.info("running typescript validation")
            const cmd = "npx tsc --noEmit --pretty false"
            try {
                const result = await $`npx tsc --noEmit --pretty false`.cwd(Instance.directory).quiet().nothrow()
                if (result.exitCode !== 0) {
                    results.push({
                        success: false,
                        command: cmd,
                        output: result.stderr.toString() || result.stdout.toString(),
                        error: "TypeScript compilation failed"
                    })
                } else {
                    results.push({ success: true, command: cmd })
                }
            } catch (e: any) {
                log.error("tsc failed", { error: e })
            }
        }

        // 2. Linting (if enabled/available)
        if (await exists(path.join(Instance.directory, ".eslintrc.json")) || await exists(path.join(Instance.directory, "eslint.config.js"))) {
            log.info("running eslint validation")
            const cmd = "npx eslint ."
            try {
                const result = await $`npx eslint . --format json`.cwd(Instance.directory).quiet().nothrow()
                if (result.exitCode !== 0) {
                    results.push({
                        success: false,
                        command: cmd,
                        output: result.stdout.toString(),
                        error: "Linting failed"
                    })
                } else {
                    results.push({ success: true, command: cmd })
                }
            } catch (e: any) {
                log.error("eslint failed", { error: e })
            }
        }

        return results
    }

    async function exists(path: string) {
        try {
            await fs.access(path)
            return true
        } catch {
            return false
        }
    }

    export function formatResults(results: ValidationResult[]): string {
        const failures = results.filter(r => !r.success)
        if (failures.length === 0) return ""

        return [
            "## Post-Execution Validation Errors",
            "The following errors were detected after your changes. Please fix them:",
            "",
            ...failures.map(f => {
                return [
                    `### ${f.error} (\`${f.command}\`)`,
                    "```",
                    f.output?.trim() || "No output",
                    "```",
                    ""
                ].join("\n")
            })
        ].join("\n")
    }
}



