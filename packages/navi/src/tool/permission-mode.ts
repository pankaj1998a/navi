import z from "zod"
import { Tool } from "./tool"
import { cyclePermissionMode, getPermissionMode, PERMISSION_MODE_CONFIG, setPermissionMode } from "../permission"

export const PermissionModeGetTool = Tool.define("permission_mode_get", {
    description: "Get the current permission mode for this session",
    parameters: z.object({}),
    execute: async () => {
        const sessionId = "default" // In a real implementation, this would come from the session context
        const mode = getPermissionMode(sessionId)
        const config = PERMISSION_MODE_CONFIG[mode]

        return {
            title: "Permission Mode",
            metadata: { mode },
            output: `Current permission mode: ${config.displayName} (${mode})
Description: ${config.description}
Available modes: safe (Explore), ask (Ask to Edit), allow-all (Execute)`,
        }
    },
})

export const PermissionModeSetTool = Tool.define("permission_mode_set", {
    description: "Set the permission mode for this session",
    parameters: z.object({
        mode: z.enum(["safe", "ask", "allow-all"]).describe("The permission mode to set"),
    }),
    execute: async (args) => {
        const sessionId = "default" // In a real implementation, this would come from the session context
        setPermissionMode(sessionId, args.mode)
        const config = PERMISSION_MODE_CONFIG[args.mode]

        return {
            title: "Permission Mode Set",
            metadata: { mode: args.mode },
            output: `Permission mode set to: ${config.displayName} (${args.mode})
Description: ${config.description}`,
        }
    },
})

export const PermissionModeCycleTool = Tool.define("permission_mode_cycle", {
    description: "Cycle to the next permission mode for this session",
    parameters: z.object({}),
    execute: async () => {
        const sessionId = "default" // In a real implementation, this would come from the session context
        const newMode = cyclePermissionMode(sessionId)
        const config = PERMISSION_MODE_CONFIG[newMode]

        return {
            title: "Permission Mode Cycled",
            metadata: { mode: newMode },
            output: `Permission mode cycled to: ${config.displayName} (${newMode})
Description: ${config.description}
Next mode: ${PERMISSION_MODE_CONFIG["safe" === newMode ? "ask" : "allow-all" === newMode ? "safe" : "allow-all"].displayName}`,
        }
    },
})
