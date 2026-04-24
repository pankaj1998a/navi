import { Tool } from "./tool"
import { Session } from "../session"
import { Snapshot } from "../snapshot"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { MessageV2 } from "../session/message-v2"
import z from "zod"

const log = Log.create({ service: "undo-tool" })

export const UndoTool = Tool.define("undo", {
  description: "Undo the last file-modifying action by reverting to the previous project snapshot.",
  parameters: z.object({}),
  async execute(_paramsInternal, ctx) {
    const messages = await Session.messages({ sessionID: ctx.sessionID })
    
    // Find the last assistant message that completed a step with a snapshot
    let lastSnapshot: string | undefined
    let messageIndex = -1

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info.role !== "assistant") continue

      // Look for the snapshot taken BEFORE the changes (at step-start)
      const startPart = msg.parts.find(p => p.type === "step-start" && p.snapshot)
      if (startPart && startPart.type === "step-start") {
        lastSnapshot = startPart.snapshot
        messageIndex = i
        break
      }
    }

    if (!lastSnapshot) {
      return {
        title: "Undo Failed",
        output: "No recent file changes found to undo in this session.",
        metadata: {
          hash: undefined,
          undoneMessageIndex: -1
        } as any,
      }
    }

    log.info("Undoing last action", { snapshot: lastSnapshot })
    await Snapshot.restore(lastSnapshot)

    // Notify the TUI/Bus that files might have changed
    await Bus.publish(FileWatcher.Event.Updated, { file: "*", event: "change" })

    return {
      title: "Undo Successful",
      output: `Reverted project state to snapshot ${lastSnapshot.substring(0, 7)} (before the last assistant action).`,
      metadata: { 
        hash: lastSnapshot,
        undoneMessageIndex: messageIndex
      } as any
    }
  },
})


