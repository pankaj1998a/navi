import z from 'zod';
import { ProviderID, ModelID } from '../provider/schema';

export const AgentContract = z.object({
    allowedActions: z.array(z.string()),
    successCriteria: z.array(z.string()),
    expectedOutputShape: z.array(z.string()),
    escalationRules: z.array(z.string()),
}).meta({
    ref: 'AgentContract',
});
export type AgentContract = z.infer<typeof AgentContract>;

export const AgentInfo = z
    .object({
        id: z.string().optional(),
        name: z.string(),
        displayName: z.string().optional(),
        description: z.string().optional(),
        mode: z.enum(['subagent', 'primary', 'all', 'parallel']),
        model: z
            .object({
                modelID: ModelID.zod,
                providerID: ProviderID.zod,
            })
            .optional(),
        toolNames: z.array(z.string()).optional(),
        options: z.record(z.string(), z.any()),
        permission: z.any().optional(),
    })
    .meta({
        ref: 'Agent',
    });

export type AgentInfo = z.infer<typeof AgentInfo>;
