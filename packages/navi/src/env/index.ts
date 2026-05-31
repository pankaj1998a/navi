import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"

type State = Record<string, string | undefined>

export interface Interface {
  readonly get: (key: string) => Effect.Effect<string | undefined>
  readonly all: () => Effect.Effect<State>
  readonly set: (key: string, value: string) => Effect.Effect<void>
  readonly remove: (key: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@navi/Env") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(Effect.fn("Env.state")(() => Effect.succeed({ ...process.env })))

    const get = Effect.fn("Env.get")((key: string) => InstanceState.use(state, (env) => env[key]))
    const all = Effect.fn("Env.all")(() => InstanceState.get(state))
    const set = Effect.fn("Env.set")(function* (key: string, value: string) {
      const env = yield* InstanceState.get(state)
      env[key] = value
    })
    const remove = Effect.fn("Env.remove")(function* (key: string) {
      const env = yield* InstanceState.get(state)
      delete env[key]
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const defaultLayer = layer

export async function get(key: string) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Service.use((s) => s.get(key)))
}

export async function all() {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Service.use((s) => s.all()))
}

export async function set(key: string, value: string) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Service.use((s) => s.set(key, value)))
}

export async function remove(key: string) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  return AppRuntime.runPromise(Service.use((s) => s.remove(key)))
}

export * as Env from "."


