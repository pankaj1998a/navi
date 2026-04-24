import z from 'zod';
import { ProviderID, ModelID } from '../provider/schema';

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

import { Effect, ServiceMap } from 'effect';

export namespace Agent {
  export const Info = AgentInfo;
  export type Info = AgentInfo;

  export interface Interface {
    readonly list: () => Effect.Effect<Info[]>;
    readonly get: (id: string) => Effect.Effect<Info | null>;
    readonly defaultAgent: () => Effect.Effect<string>;
  }

  export class Service extends ServiceMap.Service<Service, Interface>()('@navi/Agent') {}
}
