import * as prompts from "@clack/prompts"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { Snapshot } from "../../snapshot"
import { Storage } from "../../storage/storage"
import { Instance } from "../../project/instance"

type CheckpointMeta = {
    name?: string
    note?: string
    sessionID?: string
    createdAt: number
    source: "cli"
}

type CheckpointItem = {
    hash: string
    messageID: string
    type: "start" | "finish" | "manual"
    time: number
    name?: string
    note?: string
    sessionID?: string
}

export const CheckpointCommand = cmd({
    command: "checkpoint",
    describe: "Manage project checkpoints",
    builder: (yargs) => yargs.command(ListCommand).command(CreateCommand).command(RestoreCommand).demandCommand(),
    async handler() { },
})

async function latestSessionID() {
    const sessions = []
    for await (const session of Session.list()) {
        sessions.push(session)
    }
    sessions.sort((a, b) => b.time.updated - a.time.updated)
    return sessions[0]?.id
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

async function collectCheckpoints(sessionID: string) {
    const projectID = Instance.project.id
    const metadata = await loadCheckpointMeta(projectID)
    const messages = await Session.messages({ sessionID })
    const checkpoints: CheckpointItem[] = []

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
                    sessionID: meta?.sessionID,
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
                    sessionID: meta?.sessionID,
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
                    sessionID: meta?.sessionID,
                })
            }
        }
    }

    checkpoints.sort((a, b) => b.time - a.time)
    return checkpoints
}

const ListCommand = cmd({
    command: "list [session]",
    describe: "List checkpoints for a session",
    builder: (yargs) =>
        yargs.positional("session", {
            type: "string",
            description: "Session ID (optional, defaults to latest)",
        }),
    async handler(args) {
        await bootstrap(process.cwd(), async () => {
            const sessionID = args.session ?? (await latestSessionID())
            if (!sessionID) {
                console.log("No sessions found.")
                return
            }

            const checkpoints = await collectCheckpoints(sessionID)
            if (checkpoints.length === 0) {
                console.log(`No checkpoints found for session ${sessionID}`)
                return
            }

            console.log(`Checkpoints for session ${sessionID}:`)
            checkpoints.forEach((cp, i) => {
                const date = new Date(cp.time).toISOString()
                const name = cp.name ? ` | Name: ${cp.name}` : ""
                const note = cp.note ? ` | Note: ${cp.note}` : ""
                console.log(`[${i}] Hash: ${cp.hash.substring(0, 7)}${name}${note} | Time: ${date} | Type: ${cp.type}`)
            })
        })
    },
})

const CreateCommand = cmd({
    command: "create [message..]",
    describe: "Create a checkpoint for the current project state",
    builder: (yargs) =>
        yargs.option("name", {
            type: "string",
            description: "Optional human-friendly checkpoint name",
        }).positional("message", {
            type: "string",
            array: true,
            default: [],
            description: "Optional note to print with the checkpoint",
        }),
    async handler(args) {
        await bootstrap(process.cwd(), async () => {
            const hash = await Snapshot.track()
            if (!hash) {
                console.log("Snapshot tracking is disabled for this project.")
                return
            }
            const message = (args.message ?? []).filter((x) => typeof x === "string" && x.trim().length > 0).join(" ")
            const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined
            const sessionID = await latestSessionID()
            const metadata: CheckpointMeta = {
                name,
                note: message || undefined,
                sessionID,
                createdAt: Date.now(),
                source: "cli",
            }
            await Storage.write(["checkpoint", "meta", Instance.project.id, hash], metadata)
            console.log(`Created checkpoint ${hash}${name ? `\nName: ${name}` : ""}${message ? `\nNote: ${message}` : ""}`)
        })
    },
})

const RestoreCommand = cmd({
    command: "restore [hash]",
    describe: "Restore project to a checkpoint hash",
    builder: (yargs) =>
        yargs.positional("hash", {
            type: "string",
            description: "Checkpoint hash (full or partial)",
        }),
    async handler(args) {
        await bootstrap(process.cwd(), async () => {
            try {
                let target = args.hash
                if (!target) {
                    const sessionID = await latestSessionID()
                    if (!sessionID) {
                        console.log("No sessions found.")
                        return
                    }

                    const checkpoints = await collectCheckpoints(sessionID)
                    if (checkpoints.length === 0) {
                        console.log(`No checkpoints found for session ${sessionID}`)
                        return
                    }

                    const selected = await prompts.select({
                        message: "Select a checkpoint to restore",
                        options: checkpoints.map((cp) => ({
                            label: `${cp.name ?? cp.hash.substring(0, 7)} • ${new Date(cp.time).toISOString()} • ${cp.type}`,
                            value: cp.hash,
                            hint: cp.note ?? cp.messageID,
                        })),
                    })
                    if (prompts.isCancel(selected)) return
                    target = selected.toString()
                } else {
                    const sessionID = await latestSessionID()
                    if (sessionID) {
                        const checkpoints = await collectCheckpoints(sessionID)
                        const exact = checkpoints.find((cp) => cp.hash.startsWith(target!))
                        const byName = checkpoints.find((cp) => cp.name?.toLowerCase() === target!.toLowerCase())
                        const byNote = checkpoints.find((cp) => cp.note?.toLowerCase() === target!.toLowerCase())
                        target = exact?.hash ?? byName?.hash ?? byNote?.hash ?? target
                    }
                }

                if (!target) throw new Error("Checkpoint hash is required")
                await Snapshot.restore(target)
                console.log(`Restored to ${target}`)
            } catch (e) {
                console.error(`Failed to restore: ${e}`)
            }
        })
    },
})
