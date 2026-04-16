import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { SessionID } from "./schema"
import z from "zod"
import { JsonlStorage } from "../storage/jsonl"
import { SyncEvent } from "../sync"

export namespace Todo {
  export const Info = z
    .object({
      id: z.string().describe("Unique identifier for the task"),
      content: z.string().describe("Brief description of the task"),
      status: z.string().describe("Current status of the task: pending, in_progress, completed, cancelled"),
      priority: z.string().describe("Priority level of the task: high, medium, low"),
    })
    .meta({ ref: "Todo" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: SyncEvent.define({
      type: "todo.updated",
      version: 1,
      aggregate: "sessionID",
      schema: z.object({
        sessionID: SessionID.zod,
        todos: z.array(Info),
      }),
    }),
  }

  export async function update(input: { sessionID: SessionID; todos: Info[] }) {
    await SyncEvent.run(Event.Updated, input)
  }

  export function get(sessionID: SessionID) {
    const item = JsonlStorage.readItemSync<{ todos: Info[] }>("todos", sessionID)
    return item?.todos ?? []
  }
}
