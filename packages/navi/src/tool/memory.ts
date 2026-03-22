import { Tool } from "./tool"
import z from "zod"
import { SharedMemory } from "../agent/memory"

export const MemoryTool = Tool.define("memory", async (ctx) => {
    const schema = z.object({
        action: z.enum(["get", "set", "list", "delete", "clear"]),
        key: z.string().optional().describe("Key to get/set/delete"),
        value: z.any().optional().describe("Value to set (JSON serializable)"),
        namespace: z.string().default("global").describe("Namespace for the memory (default: global)"),
    })

    return {
        description: "Access shared memory for agents to store and retrieve persistent data. Supports namespaces for organizing data.",
        parameters: schema,
        async execute(params: z.infer<typeof schema>, ctx) {
            const namespace = params.namespace ?? "global"

            if (params.action === "list") {
                const keys = await SharedMemory.list(namespace)
                return {
                    title: `Shared Memory Keys (${namespace})`,
                    output: keys.length > 0 ? keys.join("\n") : "Memory is empty.",
                    metadata: {},
                }
            }

            if (params.action === "get") {
                if (!params.key) throw new Error("Key is required for get action")
                const value = await SharedMemory.get(params.key, namespace)
                return {
                    title: `Memory: ${namespace}/${params.key}`,
                    output: value !== undefined ? JSON.stringify(value, null, 2) : "Key not found.",
                    metadata: {},
                }
            }

            if (params.action === "set") {
                if (!params.key) throw new Error("Key is required for set action")
                if (params.value === undefined) throw new Error("Value is required for set action")
                await SharedMemory.set(params.key, params.value, namespace)
                return {
                    title: "Memory Set",
                    output: `Set ${namespace}/${params.key} = ${JSON.stringify(params.value)}`,
                    metadata: {},
                }
            }

            if (params.action === "delete") {
                if (!params.key) throw new Error("Key is required for delete action")
                await SharedMemory.remove(params.key, namespace)
                return {
                    title: "Memory Deleted",
                    output: `Deleted ${namespace}/${params.key}`,
                    metadata: {},
                }
            }

            if (params.action === "clear") {
                await SharedMemory.clear(namespace)
                return {
                    title: "Memory Cleared",
                    output: `Cleared all keys in namespace ${namespace}`,
                    metadata: {},
                }
            }

            return { title: "Error", output: "Invalid action", metadata: {} }
        }
    }
})
