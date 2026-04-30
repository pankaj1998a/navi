import { Effect, Layer, ServiceMap } from "effect"
import { Hooks } from './types';

export namespace Plugin {
  export type TriggerName = string;
  export interface Interface {
    readonly trigger: (name: any, input: any, output: any) => Effect.Effect<any>
    readonly list: () => Effect.Effect<any[]>
  }
  export class Service extends ServiceMap.Service<Service, Interface>()("@navi/Plugin") {}

  export const defaultLayer = Layer.succeed(Service, {
    trigger: () => Effect.succeed({}),
    list: () => Effect.succeed([]),
  })
}
export * from './types';
