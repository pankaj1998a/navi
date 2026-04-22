import { Tool } from "./tool"
import { MemoryService } from "../agent/memory/service"
import z from "zod"
import { makeRuntime } from "@/effect/run-service"

export const MemoryTool = Tool.define("save_memory", {
    description: "Save a new memory or update an existing one. Use this when you find information about the user, project goals, feedback, or external references that would be useful in future conversations. Do NOT save derivable information like code snippets or git history.",
    parameters: z.object({
        name: z.string().describe("Short, unique name for the memory (e.g. 'User Role', 'Testing Policy')"),
        description: z.string().describe("One-line summary of what this memory contains"),
        type: z.enum(["user", "feedback", "project", "reference"] as const).describe("The type of information being stored"),
        content: z.string().describe("The actual content to remember. For feedback/project, include 'Why' and 'How to apply'"),
        scope: z.enum(["private", "team"] as const).default("private").describe("Whether this is just for this user or shared (default: private)")
    }),
    execute: async (args, _ctx) => {
        const { NodeFileSystem } = await import("@effect/platform-node")
        const { Instance } = await import("@/project/instance")
        const instance = Instance.current
        const { InstanceRef } = await import("@/effect/instance-ref")
        const { Layer } = await import("effect")
        const { AppFileSystem } = await import("@/filesystem")

        const runtime = makeRuntime(MemoryService.Service, MemoryService.layer.pipe(
            Layer.provide(AppFileSystem.layer),
            Layer.provide(NodeFileSystem.layer),
            Layer.provide(Layer.succeed(InstanceRef, instance))
        ))
        await runtime.runPromise((memory) => memory.save(args))
        return {
            output: `Memory '${args.name}' saved successfully to ${args.scope} storage.`,
            title: `Saved Memory: ${args.name}`,
            metadata: {}
        }
    }
})
