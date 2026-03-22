import { Agent } from "./agent"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { $ } from "bun"
import { Log } from "../util/log"

export namespace AutoDebug {
    const log = Log.create({ service: "auto-debug" })

    export async function run(command: string, maxRetries = 3, sessionID: string) {
        let attempts = 0
        while (attempts < maxRetries) {
            attempts++
            try {
                log.info("running command", { command, attempt: attempts })
                // Run command
                const { stdout, stderr, exitCode } = await $`${{ raw: command }}`.nothrow().quiet()

                if (exitCode === 0) {
                    return { success: true, output: stdout.toString() }
                }

                const errorOutput = stderr.toString() + "\n" + stdout.toString()
                log.warn("command failed", { command, exitCode, errorOutput })

                // If failed, ask debug agent
                const debugAgent = await Agent.get("debug")
                if (!debugAgent) throw new Error("Debug agent not found")

                const session = await Session.create({
                    parentID: sessionID,
                    title: `Auto-Debug Attempt ${attempts}: ${command}`,
                })

                const messageID = Identifier.ascending("message")
                const result = await SessionPrompt.prompt({
                    messageID,
                    sessionID: session.id,
                    agent: "debug",
                    parts: [{
                        type: "text",
                        text: `The command "${command}" failed with exit code ${exitCode}.\n\nOutput:\n${errorOutput}\n\nAnalyze the error and apply a fix. If you fix it, say "FIXED".`
                    }]
                })

                const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
                if (!text.includes("FIXED")) {
                    return { success: false, output: errorOutput, analysis: text }
                }

                // Retry loop continues
            } catch (e) {
                return { success: false, error: String(e) }
            }
        }
        return { success: false, error: "Max retries exceeded" }
    }
}
