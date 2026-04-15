import { SyncEvent } from "@/sync"
import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { Todo } from "./todo"
import { JsonlStorage } from "@/storage/jsonl"
import { Log } from "../util/log"

const log = Log.create({ service: "session.projector" })

function patch(target: any, source: any) {
  for (const [key, value] of Object.entries(source)) {
    if (value === null) {
      delete target[key]
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {}
      patch(target[key], value)
    } else {
      target[key] = value
    }
  }
}

export default [
  SyncEvent.project(Session.Event.Created, async (data) => {
    await JsonlStorage.writeItem("sessions", data.info.id, data.info)
  }),

  SyncEvent.project(Session.Event.Updated, async (data) => {
    const existing = await JsonlStorage.readItem<Session.Info>("sessions", data.sessionID)
    if (!existing) {
      log.warn("Session not found for update", { sessionID: data.sessionID })
      return
    }
    patch(existing, data.info)
    await JsonlStorage.writeItem("sessions", data.sessionID, existing)
  }),

  SyncEvent.project(Session.Event.Deleted, async (data) => {
    await JsonlStorage.deleteItem("sessions", data.sessionID)
    await JsonlStorage.deleteLog("session_logs", data.sessionID)
  }),

  SyncEvent.project(Todo.Event.Updated, async (data) => {
    await JsonlStorage.writeItem("todos", data.sessionID, { todos: data.todos })
  }),

  SyncEvent.project(MessageV2.Event.Updated, async (data) => {
    await JsonlStorage.append("session_logs", data.sessionID, { event: "message.updated", data })
  }),

  SyncEvent.project(MessageV2.Event.Removed, async (data) => {
    await JsonlStorage.append("session_logs", data.sessionID, { event: "message.removed", data })
  }),

  SyncEvent.project(MessageV2.Event.PartRemoved, async (data) => {
    await JsonlStorage.append("session_logs", data.sessionID, { event: "message.part.removed", data })
  }),

  SyncEvent.project(MessageV2.Event.PartUpdated, async (data) => {
    await JsonlStorage.append("session_logs", data.sessionID, { event: "message.part.updated", data })
  }),
]

