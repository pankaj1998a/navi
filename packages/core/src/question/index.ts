import { Effect, ServiceMap } from 'effect';

export namespace Question {
  export interface Interface {
    readonly ask: (input: any) => Effect.Effect<any>;
  }
  export class Service extends ServiceMap.Service<Service, Interface>()('@navi/Question') {}
}
