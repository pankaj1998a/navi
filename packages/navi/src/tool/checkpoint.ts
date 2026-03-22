import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Snapshot } from "../snapshot"
import { Log } from "../util/log"
import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "checkpoint-tool" })

type CheckpointMeta = {
    name?: string
    note?: string
    sessionID?: string
    createdAt: number
    source: "tool"
}

async function loadCheckpointMeta(projectID: string) {
    const meta = new Map<string, CheckpointMeta>()
    const keys = await Storage.list(["checkpoint", "meta", projectID]).catch(() => [])

    for (const key of keys) {
        const hash = key.at(-1)
        if (!hash) continue
        try {
            meta.set(hash, await Storage.read<CheckpointMeta>(key))
        } catch { }
    }

    return meta
}

export const CheckpointTool = Tool.define("checkpoint", async () => {
    return {
        description: `Manage checkpoints (snapshots) of the project state.
You can list available checkpoints and restore the project to a previous state.
Checkpoints are automatically created at each step (tool execution or message).
Restoring a checkpoint will revert all files in the working directory to that state.`,
        parameters: z.object({
            action: z.enum(["list", "restore", "create"]).describe("The action to perform"),
            hash: z.string().optional().describe("The snapshot hash to restore to (required for 'restore')"),
            name: z.string().optional().describe("A human-friendly label for the checkpoint (optional for 'create')"),
            message: z.string().optional().describe("A description for the checkpoint (optional for 'create')"),
        }),
        async execute(params, ctx) {
            if (params.action === "create") {
                const hash = await Snapshot.track()
                if (!hash) {
                    return {
                        title: "Checkpoint Disabled",
                        output: "Snapshot tracking is disabled for this project.",
                        metadata: { hash: undefined },
                    }
                }
                const metadata: CheckpointMeta = {
                    name: params.name,
                    note: params.message,
                    sessionID: ctx.sessionID,
                    createdAt: Date.now(),
                    source: "tool",
                }
                await Storage.write(["checkpoint", "meta", Instance.project.id, hash], metadata)
                return {
                    title: "Checkpoint Created",
                    output: `Created checkpoint with hash: ${hash}${params.name ? `\nName: ${params.name}` : ""}${params.message ? `\nDescription: ${params.message}` : ""}`,
                    metadata: { hash }
                }
            } else if (params.action === "list") {
                const metadata = await loadCheckpointMeta(Instance.project.id)
                const messages = await Session.messages({ sessionID: ctx.sessionID })
                const checkpoints = []

                for (const msg of messages) {
                    for (const part of msg.parts) {
                        if (part.type === "step-start" && part.snapshot) {
                            const meta = metadata.get(part.snapshot)
                            checkpoints.push({
                                hash: part.snapshot,
                                messageID: msg.info.id,
                                type: "start",
                                time: msg.info.time.created,
                                name: meta?.name,
                                note: meta?.note,
                            })
                        } else if (part.type === "step-finish" && part.snapshot) {
                            const meta = metadata.get(part.snapshot)
                            checkpoints.push({
                                hash: part.snapshot,
                                messageID: msg.info.id,
                                type: "finish",
                                time: msg.info.role === "assistant" && msg.info.time.completed ? msg.info.time.completed : msg.info.time.created,
                                name: meta?.name,
                                note: meta?.note,
                            })
                        } else if (part.type === "snapshot" && part.snapshot) {
                            const meta = metadata.get(part.snapshot)
                            checkpoints.push({
                                hash: part.snapshot,
                                messageID: msg.info.id,
                                type: "manual",
                                time: msg.info.time.created,
                                name: meta?.name,
                                note: meta?.note,
                            })
                        }
                    }
                }

                // Sort by time descending
                checkpoints.sort((a, b) => b.time - a.time)

                const output = checkpoints.map((cp, i) => {
                    const date = new Date(cp.time).toISOString()
                    const name = cp.name ? ` | Name: ${cp.name}` : ""
                    const note = cp.note ? ` | Note: ${cp.note}` : ""
                    return `[${i}] Hash: ${cp.hash.substring(0, 7)}${name}${note} | Time: ${date} | Type: ${cp.type} | Msg: ${cp.messageID}`
                }).join("\n")

                return {
                    title: "Checkpoints",
                    output: output || "No checkpoints found.",
                    metadata: { hash: undefined }
                }
            } else if (params.action === "restore") {
                if (!params.hash) throw new Error("Hash is required for restore action")

                // Find the full hash if short hash is provided
                let targetHash = params.hash
                if (params.hash.length < 40) {
                    const metadata = await loadCheckpointMeta(Instance.project.id)
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
                    if (!found) {
                        for (const [hash, meta] of metadata.entries()) {
                            if (meta.name?.toLowerCase() === params.hash.toLowerCase() || meta.note?.toLowerCase() === params.hash.toLowerCase()) {
                                targetHash = hash
                                found = true
                                break
                            }
                        }
                    }
                    if (!found) throw new Error(`Checkpoint with hash prefix ${params.hash} not found`)
                }

                await Snapshot.restore(targetHash)

                return {
                    title: "Checkpoint Restored",
                    output: `Restored project state to snapshot ${targetHash}`,
                    metadata: { hash: undefined }
                }
            }

            throw new Error(`Unknown action: ${params.action}`)
        }
    }
})
