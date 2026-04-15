import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"

export const SessionListTool = Tool.define("session_list", {
    description: "List available sessions for the current project.",
    parameters: z.object({
        limit: z.number().optional().describe("Maximum number of sessions to return"),
    }),
    execute: async (args) => {
        const sessions = []
        for await (const session of Session.list()) {
            sessions.push(session)
        }

        // Sort by updated time descending
        sessions.sort((a, b) => b.time.updated - a.time.updated)

        const limited = args.limit ? sessions.slice(0, args.limit) : sessions

        if (limited.length === 0) {
            return {
                title: "Session List",
                metadata: {},
                output: "No sessions found",
            }
        }

        const lines = limited.map((s) => {
            const date = new Date(s.time.updated).toLocaleString()
            return `[${s.id}] ${s.title} (Updated: ${date})`
        })

        return {
            title: "Session List",
            metadata: {},
            output: lines.join("\n"),
        }
    },
})

export const SessionReadTool = Tool.define("session_read", {
    description: "Read messages from a specific session.",
    parameters: z.object({
        session_id: z.string().describe("The ID of the session to read"),
        limit: z.number().optional().describe("Maximum number of messages to return"),
    }),
    execute: async (args) => {
        try {
            const msgs = await Session.messages({
                sessionID: args.session_id,
                limit: args.limit,
            })

            if (msgs.length === 0) {
                return {
                    title: `Session Read: ${args.session_id}`,
                    metadata: {},
                    output: "No messages found in session",
                }
            }

            const lines = msgs.map((m) => {
                const role = m.info.role.toUpperCase()
                const text = m.parts
                    .filter((p) => p.type === "text")
                    .map((p) => (p as any).text)
                    .join("\n")
                return `--- ${role} ---\n${text}`
            })

            return {
                title: `Session Read: ${args.session_id}`,
                metadata: {},
                output: lines.join("\n\n"),
            }
        } catch (e) {
            return {
                title: "Error",
                metadata: {},
                output: `Error reading session: ${String(e)}`,
            }
        }
    },
})

export const SessionInfoTool = Tool.define("session_info", {
    description: "Get detailed information about a session.",
    parameters: z.object({
        session_id: z.string().describe("The ID of the session to inspect"),
    }),
    execute: async (args) => {
        try {
            const session = await Session.get(args.session_id)
            if (!session) {
                return {
                    title: "Session Info",
                    metadata: {},
                    output: "Session not found",
                }
            }

            const info = [
                `ID: ${session.id}`,
                `Title: ${session.title}`,
                `Directory: ${session.directory}`,
                `Created: ${new Date(session.time.created).toLocaleString()}`,
                `Updated: ${new Date(session.time.updated).toLocaleString()}`,
                `Parent ID: ${session.parentID || "None"}`,
            ]

            if (session.summary) {
                info.push(`Summary: ${session.summary.files} files, +${session.summary.additions}, -${session.summary.deletions}`)
            }

            return {
                title: `Session Info: ${args.session_id}`,
                metadata: {},
                output: info.join("\n"),
            }
        } catch (e) {
            return {
                title: "Error",
                metadata: {},
                output: `Error getting session info: ${String(e)}`,
            }
        }
    },
})


