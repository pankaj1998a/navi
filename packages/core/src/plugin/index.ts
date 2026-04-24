import { Effect, ServiceMap } from 'effect';
import { Hooks } from './types';

export namespace Plugin {
  export type TriggerName = string;
  export interface Interface {
    readonly trigger: (name: any, input: any, output: any) => Effect.Effect<any>;
  }
  export class Service extends ServiceMap.Service<Service, Interface>()('@navi/Plugin') {}
}
export * from './types';
