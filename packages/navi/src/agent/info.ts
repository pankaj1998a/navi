import z from "zod"
import { PermissionNext } from "../permission/next"
import { AgentPolicy } from "./policy"

export const AgentContract = z.object({
    allowedActions: z.array(z.string()),
    successCriteria: z.array(z.string()),
    expectedOutputShape: z.array(z.string()),
    escalationRules: z.array(z.string()),
}).meta({
    ref: "AgentContract",
})
export type AgentContract = z.infer<typeof AgentContract>

export const AgentInfo = z
    .object({
        id: z.string().optional(),
        name: z.string(),
        displayName: z.string().optional(),
        description: z.string().optional(),
        version: z.string().optional(),
        mode: z.enum(["subagent", "primary", "all", "parallel"]),
        native: z.boolean().optional(),
        hidden: z.boolean().optional(),
        topP: z.number().optional(),
        temperature: z.number().optional(),
        color: z.string().optional(),
        permission: PermissionNext.Ruleset,
        model: z
            .object({
                modelID: z.string(),
                providerID: z.string(),
            })
            .optional(),
        prompt: z.string().optional(),
        options: z.record(z.string(), z.any()),
        steps: z.number().int().positive().optional(),
        categories: z.array(z.string()).optional(),
        capabilities: z.array(z.string()).optional(),
        spawnableAgents: z.array(z.string()).optional(),
        toolNames: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
        contract: AgentContract.optional(),
        executionPolicy: AgentPolicy.Info.optional(),
        inputSchema: z.any().optional(),
        outputSchema: z.any().optional(),
        modes: z.record(z.string(), z.object({
            model: z.object({ modelID: z.string(), providerID: z.string() }),
            tokens: z.number().optional(),
            temperature: z.number().optional(),
        })).optional(),
        author: z.string().optional(),
        license: z.string().optional(),
        tags: z.array(z.string()).optional(),
        examples: z.array(z.any()).optional(),
        handleSteps: z.any().optional(), // Async generator function for programmatic control
    })
    .meta({
        ref: "Agent",
    })

export type AgentInfo = z.infer<typeof AgentInfo>
