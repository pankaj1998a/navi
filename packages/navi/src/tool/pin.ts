import { Tool } from "./tool"
import z from "zod"
import { SessionPin } from "../session/pin"

const pinParameters = z.object({
    action: z.enum(["add", "remove", "list"]),
    files: z.array(z.string()).optional().describe("Files to pin/unpin"),
})

export const PinTool = Tool.define("pin", async (ctx) => {
    return {
        description: "Pin or unpin files to the context. Pinned files are always included in the system prompt.",
        parameters: pinParameters,
        async execute(params: z.infer<typeof pinParameters>, ctx) {
            if (params.action === "list") {
                const files = await SessionPin.list(ctx.sessionID)
                return {
                    title: "Pinned Files",
                    output: files.length > 0 ? files.join("\n") : "No files pinned.",
                    metadata: {},
                }
            }

            if (!params.files || params.files.length === 0) {
                throw new Error("Files argument is required for add/remove actions")
            }

            if (params.action === "add") {
                const files = await SessionPin.add(ctx.sessionID, params.files)
                return {
                    title: "Pinned Files Added",
                    output: `Pinned:\n${params.files.join("\n")}\n\nCurrent Pinned:\n${files.join("\n")}`,
                    metadata: {},
                }
            }

            if (params.action === "remove") {
                const files = await SessionPin.remove(ctx.sessionID, params.files)
                return {
                    title: "Pinned Files Removed",
                    output: `Unpinned:\n${params.files.join("\n")}\n\nCurrent Pinned:\n${files.join("\n")}`,
                    metadata: {},
                }
            }

            return { title: "Error", output: "Invalid action", metadata: {} }
        }
    }
})


