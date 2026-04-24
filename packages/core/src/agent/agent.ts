import { AgentInfo } from './info';
import { Effect, Layer, ServiceMap } from 'effect';

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
