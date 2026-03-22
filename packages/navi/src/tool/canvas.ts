import z from "zod"
import { Tool } from "./tool"
import { CanvasIPC } from "../canvas/ipc"
import { BunProc } from "@/bun"
import path from "path"
import { Global } from "../global"

const CanvasParameters = z.object({
    id: z.string().describe("Unique identifier for the canvas"),
    action: z.enum(["create", "update", "close"]).describe("Action to perform"),
    type: z.enum(["markdown", "code", "dashboard"]).optional().describe("Type of content"),
    content: z.string().optional().describe("Content to display"),
})

type CanvasParameters = z.infer<typeof CanvasParameters>

export const CanvasTool: Tool.Info = {
    id: "canvas",
    init: async () => ({
        description: "Create or update an interactive Canvas window for documents, dashboards, or code.",
        parameters: CanvasParameters,
        execute: async (args: CanvasParameters) => {
            if (args.action === "create") {
                // Spawn a new terminal process for the canvas
                // In a real TUI, this might open a new pane or window.
                // For now, we'll simulate by starting the canvas process.
                const canvasAppPath = path.join(import.meta.dir, "../canvas/app.tsx")
                if (!(await Bun.file(canvasAppPath).exists())) {
                    return {
                        title: "Canvas Unavailable",
                        output: "The Canvas tool is not available in this build of Navi (source file not found).",
                        metadata: { error: true }
                    }
                }
                Bun.spawn(["bun", canvasAppPath, args.id], {
                    stdout: "inherit",
                    stderr: "inherit",
                    stdin: "inherit",
                })

                return {
                    title: "Canvas Created",
                    output: `Canvas '${args.id}' created.`,
                    metadata: {},
                }
            }

            if (args.action === "update") {
                if (!args.content || !args.type) {
                    return {
                        title: "Canvas Update Error",
                        output: "Error: content and type are required for update action.",
                        metadata: { error: true },
                    }
                }

                // Connect and send update
                try {
                    const socket = await CanvasIPC.connect(args.id, () => { })
                    CanvasIPC.send(socket, {
                        type: "update",
                        content: args.content,
                        contentType: args.type,
                    })
                    socket.end()
                    return {
                        title: "Canvas Updated",
                        output: `Canvas '${args.id}' updated.`,
                        metadata: {},
                    }
                } catch (e) {
                    return {
                        title: "Canvas Update Error",
                        output: `Error updating canvas: ${String(e)}`,
                        metadata: { error: true },
                    }
                }
            }

            return {
                title: "Canvas Action",
                output: `Action '${args.action}' completed.`,
                metadata: {},
            }
        },
    }),
}
