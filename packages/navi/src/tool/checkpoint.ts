import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Snapshot } from "../snapshot"
import { Log } from "../util/log"

const log = Log.create({ service: "checkpoint-tool" })

export const CheckpointTool = Tool.define("checkpoint", async () => {
    return {
        description: `Manage checkpoints (snapshots) of the project state.
You can list available checkpoints and restore the project to a previous state.
Checkpoints are automatically created at each step (tool execution or message).
Restoring a checkpoint will revert all files in the working directory to that state.`,
        parameters: z.object({
            action: z.enum(["list", "restore"]).describe("The action to perform"),
            hash: z.string().optional().describe("The snapshot hash to restore to (required for 'restore')"),
        }),
        async execute(params, ctx) {
            if (params.action === "list") {
                const messages = await Session.messages({ sessionID: ctx.sessionID })
                const checkpoints = []

                for (const msg of messages) {
                    for (const part of msg.parts) {
                        if (part.type === "step-start" && part.snapshot) {
                            checkpoints.push({
                                hash: part.snapshot,
                                messageID: msg.info.id,
                                type: "start",
                                time: msg.info.time.created
                            })
                        } else if (part.type === "step-finish" && part.snapshot) {
                            checkpoints.push({
                                hash: part.snapshot,
                                messageID: msg.info.id,
                                type: "finish",
                                time: msg.info.role === "assistant" && msg.info.time.completed ? msg.info.time.completed : msg.info.time.created
                            })
                        } else if (part.type === "snapshot" && part.snapshot) {
                            checkpoints.push({
                                hash: part.snapshot,
                                messageID: msg.info.id,
                                type: "manual",
                                time: msg.info.time.created
                            })
                        }
                    }
                }

                // Sort by time descending
                checkpoints.sort((a, b) => b.time - a.time)

                const output = checkpoints.map((cp, i) => {
                    const date = new Date(cp.time).toISOString()
                    return `[${i}] Hash: ${cp.hash.substring(0, 7)} | Time: ${date} | Type: ${cp.type} | Msg: ${cp.messageID}`
                }).join("\n")

                return {
                    title: "Checkpoints",
                    output: output || "No checkpoints found.",
                    metadata: {}
                }
            } else if (params.action === "restore") {
                if (!params.hash) throw new Error("Hash is required for restore action")

                // Find the full hash if short hash is provided
                let targetHash = params.hash
                if (params.hash.length < 40) {
                    const messages = await Session.messages({ sessionID: ctx.sessionID })
                    let found = false
                    for (const msg of messages) {
                        for (const part of msg.parts) {
                            if ((part.type === "step-start" || part.type === "step-finish" || part.type === "snapshot") && part.snapshot && part.snapshot.startsWith(params.hash)) {
                                targetHash = part.snapshot
                                found = true
                                break
                            }
                        }
                        if (found) break
                    }
                    if (!found) throw new Error(`Checkpoint with hash prefix ${params.hash} not found`)
                }

                await Snapshot.restore(targetHash)

                return {
                    title: "Checkpoint Restored",
                    output: `Restored project state to snapshot ${targetHash}`,
                    metadata: {}
                }
            }

            throw new Error(`Unknown action: ${params.action}`)
        }
    }
})
