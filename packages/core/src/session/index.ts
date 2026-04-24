import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { Provider } from "../provider/provider"
import { Permission } from "../permission"
import { Effect, ServiceMap } from "effect"
import z from "zod"

export namespace Session {
  export const Info = z.object({
    id: SessionID.zod,
    slug: z.string(),
    projectID: z.string(),
    workspaceID: z.string().optional(),
    directory: z.string(),
    parentID: SessionID.zod.optional(),
    title: z.string(),
    version: z.string(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
    permission: Permission.Ruleset.optional(),
  })
  export type Info = z.infer<typeof Info>

  export const getUsage = (input: {
    model: Provider.Model
    usage: any
    metadata?: any
  }) => {
    return { cost: 0, tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { write: 0, read: 0 } } }
  }

  export interface Interface {
    readonly create: (input?: any) => Effect.Effect<Info>
    readonly get: (id: SessionID) => Effect.Effect<Info>
    readonly messages: (input: { sessionID: SessionID; limit?: number }) => Effect.Effect<MessageV2.WithParts[]>
    readonly updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
    readonly updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
    readonly touch: (sessionID: SessionID) => Effect.Effect<void>
    readonly remove: (sessionID: SessionID) => Effect.Effect<void>
    readonly setSummary: (input: { sessionID: SessionID; summary: any }) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@navi/Session") {}

  export const Event = {
    Error: { type: "session.error" } as any,
  }
}
