import z from "zod"
import sessionProjectors from "../session/projectors"
import { SyncEvent } from "@/sync"
import { Session } from "@/session"
import { JsonlStorage } from "@/storage/jsonl"

export function initProjectors() {
  SyncEvent.init({
    projectors: sessionProjectors,
    convertEvent: (type, data) => {
      if (type === "session.updated") {
        const id = (data as z.infer<typeof Session.Event.Updated.schema>).sessionID
        const item = JsonlStorage.readItemSync<Session.Info>("sessions", id)

        if (!item) return data

        return {
          sessionID: id,
          info: item,
        }
      }
      return data
    },
  })
}

initProjectors()

