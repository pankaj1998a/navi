import z from "zod"
import { AgentInfo } from "./info"

export const AgentManifest = z.object({
    name: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, "Name must be in format 'author/agent'"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (x.y.z)"),
    description: z.string().max(200),
    author: z.string(),
    license: z.string().default("MIT"),
    homepage: z.string().url().optional(),
    repository: z.string().url().optional(),
    tags: z.array(z.string()).default([]),

    // The actual agent configuration
    config: AgentInfo.omit({ native: true, handleSteps: true }).extend({
        // Override specific fields to be optional or restrictive for portable agents
        permission: z.any().optional(), // Permissions are managed by the user upon install
    }),
})

export type AgentManifest = z.infer<typeof AgentManifest>
