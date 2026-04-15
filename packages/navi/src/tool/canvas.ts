import z from "zod"
import { Tool } from "./tool"
import { CanvasIPC } from "../canvas/ipc"
import { BunProc } from "@/bun"
import path from "path"
import { GlobalBus } from "../bus/global"
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
                GlobalBus.emit("event", {
                    payload: {
                        type: "canvas.opened",
                        content: args.content ?? "",
                        contentType: args.type ?? "markdown",
                    }
                })

                return {
                    title: "Canvas Created",
                    output: `Canvas '${args.id}' displayed in Sidebar.`,
                    metadata: {},
                }
            }

            if (args.action === "update") {
                if (!args.content) {
                    return {
                        title: "Canvas Update Error",
                        output: "Error: content is required for update action.",
                        metadata: { error: true },
                    }
                }

                GlobalBus.emit("event", {
                    payload: {
                        type: "canvas.updated",
                        content: args.content,
                        contentType: args.type,
                    }
                })

                return {
                    title: "Canvas Updated",
                    output: `Canvas '${args.id}' updated.`,
                    metadata: {},
                }
            }

            if (args.action === "close") {
                 GlobalBus.emit("event", {
                    payload: {
                        type: "canvas.closed",
                    }
                })
                return {
                    title: "Canvas Closed",
                    output: `Canvas '${args.id}' closed.`,
                    metadata: {},
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


