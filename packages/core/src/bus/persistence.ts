import { Effect, Layer, ServiceMap, Stream } from "effect"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"

/**
 * EventPersistence provides storage and replay capabilities for the Global Event Bus.
 */
export namespace EventPersistence {
  const log = Log.create({ service: "bus.persistence" })

  export interface Interface {
    /**
     * Persists an event to the event store.
     */
    readonly store: (event: { type: string; properties: any }) => Effect.Effect<void>
    
    /**
     * Replays events for a specific context (e.g. sessionID).
     */
    readonly replay: (contextId: string) => Stream.Stream<any>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@navi/EventPersistence") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const storage = yield* Storage.Service

      const store = (event: { type: string; properties: any }) => 
        Effect.gen(function* () {
          // Identify the context (prefer sessionID, fallback to directory)
          const contextId = event.properties?.sessionID || event.properties?.directory
          if (!contextId) return

          const eventId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          const key = ["events", contextId, eventId]
          
          yield* storage.write(key, event).pipe(
            Effect.catch((err) => {
              log.error("Failed to persist event", { type: event.type, contextId, err })
              return Effect.void
            })
          )
        })

      const replay = (contextId: string) => 
        Stream.unwrap(
          Effect.gen(function* () {
            const keys = yield* storage.list(["events", contextId])
            
            return Stream.fromIterable(keys).pipe(
              Stream.mapEffect(key => 
                storage.read<any>(key).pipe(
                  Effect.catch(() => Effect.succeed(null))
                )
              ),
              Stream.filter((e): e is any => e !== null)
            )
          })
        )

      return Service.of({ store, replay })
    })
  )

  export const defaultLayer = layer.pipe(Layer.provide(Storage.defaultLayer))
}
