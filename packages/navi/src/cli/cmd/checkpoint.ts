import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { Snapshot } from "../../snapshot"

export const CheckpointCommand = cmd({
    command: "checkpoint",
    describe: "Manage project checkpoints",
    builder: (yargs) => yargs.command(ListCommand).command(RestoreCommand).demandCommand(),
    async handler() { },
})

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
            let sessionID = args.session
            if (!sessionID) {
                const sessions = []
                for await (const session of Session.list()) {
                    sessions.push(session)
                }
                // Sort by updated time descending
                sessions.sort((a, b) => b.time.updated - a.time.updated)

                if (sessions.length > 0) {
                    sessionID = sessions[0].id
                } else {
                    console.log("No sessions found.")
                    return
                }
            }

            const messages = await Session.messages({ sessionID })
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

            checkpoints.sort((a, b) => b.time - a.time)

            if (checkpoints.length === 0) {
                console.log(`No checkpoints found for session ${sessionID}`)
                return
            }

            console.log(`Checkpoints for session ${sessionID}:`)
            checkpoints.forEach((cp, i) => {
                const date = new Date(cp.time).toISOString()
                console.log(`[${i}] Hash: ${cp.hash.substring(0, 7)} | Time: ${date} | Type: ${cp.type}`)
            })
        })
    },
})

const RestoreCommand = cmd({
    command: "restore <hash>",
    describe: "Restore project to a checkpoint hash",
    builder: (yargs) =>
        yargs.positional("hash", {
            type: "string",
            description: "Checkpoint hash (full or partial)",
            demandOption: true,
        }),
    async handler(args) {
        await bootstrap(process.cwd(), async () => {
            try {
                await Snapshot.restore(args.hash)
                console.log(`Restored to ${args.hash}`)
            } catch (e) {
                console.error(`Failed to restore: ${e}`)
            }
        })
    },
})
