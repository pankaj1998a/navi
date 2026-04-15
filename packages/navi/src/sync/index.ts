import z from "zod"
import type { ZodObject } from "zod"
import { EventEmitter } from "events"
import { JsonlStorage } from "@/storage/jsonl"
import { Flock } from "@/util/flock"
import { Global } from "@/global"
import path from "path"
import fs from "fs/promises"
import { BusEvent } from "@/bus/bus-event"

export namespace SyncEvent {
  export type Definition = {
    type: string
    version: number
    aggregate: string
    schema: z.ZodObject

    // This is temporary and only exists for compatibility with bus
    // event definitions
    properties: z.ZodObject
  }

  export type Event<Def extends Definition = Definition> = {
    id: string
    seq: number
    aggregateID: string
    data: z.infer<Def["schema"]>
  }

  export type SerializedEvent<Def extends Definition = Definition> = Event<Def> & { type: string }

  type ProjectorFunc = (data: unknown) => void | Promise<void>

  export const registry = new Map<string, Definition>()
  let projectors: Map<Definition, ProjectorFunc> | undefined
  const versions = new Map<string, number>()
  let frozen = false
  let convertEvent: (type: string, event: Event["data"]) => Promise<Record<string, unknown>> | Record<string, unknown>

  const Bus = new EventEmitter<{ event: [{ def: Definition; event: Event }] }>()

  export function reset() {
    frozen = false
    projectors = undefined
    convertEvent = (_, data) => data
  }

  export function init(input: { projectors: Array<[Definition, ProjectorFunc]>; convertEvent?: typeof convertEvent }) {
    projectors = new Map(input.projectors)

    // Install all the latest event defs to the bus. We only ever emit
    // latest versions from code, and keep around old versions for
    // replaying. Replaying does not go through the bus, and it
    // simplifies the bus to only use unversioned latest events
    for (let [type, version] of versions.entries()) {
      let def = registry.get(versionedType(type, version))!

      BusEvent.define(def.type, def.properties || def.schema)
    }

    // Freeze the system so it clearly errors if events are defined
    // after `init` which would cause bugs
    frozen = true
    convertEvent = input.convertEvent || ((_, data) => data)
  }

  export function versionedType<A extends string>(type: A): A
  export function versionedType<A extends string, B extends number>(type: A, version: B): `${A}/${B}`
  export function versionedType(type: string, version?: number) {
    return version ? `${type}.${version}` : type
  }

  export function define<
    Type extends string,
    Agg extends string,
    Schema extends ZodObject<Record<Agg, z.ZodType<string>>>,
    BusSchema extends ZodObject = Schema,
  >(input: { type: Type; version: number; aggregate: Agg; schema: Schema; busSchema?: BusSchema }) {
    if (frozen) {
      throw new Error("Error defining sync event: sync system has been frozen")
    }

    const def = {
      type: input.type,
      version: input.version,
      aggregate: input.aggregate,
      schema: input.schema,
      properties: input.busSchema ? input.busSchema : input.schema,
    }

    versions.set(def.type, Math.max(def.version, versions.get(def.type) || 0))

    registry.set(versionedType(def.type, def.version), def)

    return def
  }

  export function project<Def extends Definition>(
    def: Def,
    func: (data: Event<Def>["data"]) => void | Promise<void>,
  ): [Definition, ProjectorFunc] {
    return [def, func as ProjectorFunc]
  }

  async function process<Def extends Definition>(def: Def, event: Event<Def>, options: { publish: boolean }) {
    if (projectors == null) {
      throw new Error("No projectors available. Call `SyncEvent.init` to install projectors")
    }

    const projector = projectors.get(def)
    if (!projector) {
      throw new Error(`Projector not found for event: ${def.type}`)
    }

    await projector(event.data)

    Bus.emit("event", {
      def,
      event,
    })

    if (options?.publish) {
      const { Bus: ProjectBus } = await import("@/bus")
      const result = await convertEvent(def.type, event.data)
      ProjectBus.publish({ type: def.type, properties: def.schema }, result)
    }
  }

  // TODO:
  //
  // * Support applying multiple events at one time. One transaction,
  //   and it validets all the sequence ids
  // * when loading events from db, apply zod validation to ensure shape

  async function getLatestSeq(aggregateID: string): Promise<number> {
    const file = path.join(Global.Path.data, "jsonl", "sequences", `${aggregateID}.seq`)
    try {
      const content = await fs.readFile(file, "utf8")
      return parseInt(content.trim(), 10)
    } catch {
      return -1
    }
  }

  async function setLatestSeq(aggregateID: string, seq: number) {
    const dir = path.join(Global.Path.data, "jsonl", "sequences")
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${aggregateID}.seq`)
    await fs.writeFile(file, seq.toString())
  }

  export async function replay(event: SerializedEvent, options?: { republish: boolean }) {
    const def = registry.get(event.type)
    if (!def) {
      throw new Error(`Unknown event type: ${event.type}`)
    }

    const latest = await getLatestSeq(event.aggregateID)
    if (event.seq <= latest) {
      return
    }

    const expected = latest + 1
    if (event.seq !== expected) {
      throw new Error(`Sequence mismatch for aggregate "${event.aggregateID}": expected ${expected}, got ${event.seq}`)
    }

    await process(def, event, { publish: !!options?.republish })
    await setLatestSeq(event.aggregateID, event.seq)
  }

  export async function run<Def extends Definition>(def: Def, data: Event<Def>["data"]) {
    const agg = (data as Record<string, string>)[def.aggregate]
    if (agg == null) {
      throw new Error(`SyncEvent.run: "${def.aggregate}" required but not found: ${JSON.stringify(data)}`)
    }

    if (def.version !== versions.get(def.type)) {
      throw new Error(`SyncEvent.run: running old versions of events is not allowed: ${def.type}`)
    }

    const seqFile = path.join(Global.Path.data, "jsonl", "sequences", `${agg}.seq`)
    await Flock.withLock(seqFile, async () => {
      const latest = await getLatestSeq(agg)
      const seq = latest + 1
      const id = Date.now().toString() // Simple ID for now
      
      const event = { id, seq, aggregateID: agg, data }
      await process(def, event, { publish: true })
      await setLatestSeq(agg, seq)
      
      // Also log the event to a global log or per-aggregate log
      await JsonlStorage.append("events", agg, { ...event, type: versionedType(def.type, def.version) })
    })
  }

  export async function remove(aggregateID: string) {
    await fs.rm(path.join(Global.Path.data, "jsonl", "sequences", `${aggregateID}.seq`), { force: true })
    await JsonlStorage.deleteLog("events", aggregateID)
  }

  export function subscribeAll(handler: (event: { def: Definition; event: Event }) => void) {
    Bus.on("event", handler)
    return () => Bus.off("event", handler)
  }

  export function payloads() {
    return z
      .union(
        registry
          .entries()
          .map(([type, def]) => {
            return z
              .object({
                type: z.literal(type),
                aggregate: z.literal(def.aggregate),
                data: def.schema,
              })
              .meta({
                ref: "SyncEvent" + "." + def.type,
              })
          })
          .toArray() as any,
      )
      .meta({
        ref: "SyncEvent",
      })
  }
}

