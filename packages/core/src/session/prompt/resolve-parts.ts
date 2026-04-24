import path from "path"
import os from "os"
import fs from "fs/promises"
import { Instance } from "../../project/instance"
import { ConfigMarkdown } from "../../config/markdown"
import { Agent } from "../../agent/agent"

/**
 * Resolves @file and agent references in a prompt template string.
 */
export async function resolvePromptParts(template: string): Promise<any[]> {
    const parts: any[] = [
        {
            type: "text",
            text: template,
        },
    ]
    const files = ConfigMarkdown.files(template)
    const seen = new Set<string>()
    await Promise.all(
        files.map(async (match) => {
            const name = match[1]
            if (seen.has(name)) return
            seen.add(name)
            const filepath = name.startsWith("~/")
                ? path.join(os.homedir(), name.slice(2))
                : path.resolve(Instance.worktree, name)

            const stats = await fs.stat(filepath).catch(() => undefined)
            if (!stats) {
                const agent = await Agent.get(name)
                if (agent) {
                    parts.push({
                        type: "agent",
                        name: agent.name,
                    })
                }
                return
            }

            if (stats.isDirectory()) {
                parts.push({
                    type: "file",
                    url: `file://${filepath}`,
                    filename: name,
                    mime: "application/x-directory",
                })
                return
            }

            parts.push({
                type: "file",
                url: `file://${filepath}`,
                filename: name,
                mime: "text/plain",
            })
        }),
    )
    return parts
}



