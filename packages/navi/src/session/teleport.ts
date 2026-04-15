/**
 * Navi Session Teleportation
 *
 * Export a session to a portable archive and import it on another machine.
 * Enables seamless session migration between environments:
 *  - Local → Remote server
 *  - CI/CD pipeline continuations
 *  - Team handoffs
 *  - Session backup and restore
 *
 * Archive format: .navi-session (gzip'd JSON)
 */

import path from "path"
import { Log } from "../util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { Instance } from "../project/instance"

const log = Log.create({ service: "session.teleport" })

export type TeleportManifest = {
  version: 1
  exportedAt: string
  exportedBy: string
  sourceDirectory: string
  session: Session.Info
  messages: Array<{
    info: MessageV2.Info
    parts: MessageV2.Part[]
  }>
  totalMessages: number
  totalParts: number
}

export namespace SessionTeleport {
  /**
   * Export a session to a portable archive file.
   */
  export async function exportSession(
    sessionID: string,
    outputPath?: string,
  ): Promise<{ path: string; manifest: TeleportManifest }> {
    const session = await Session.get(SessionID.make(sessionID))
    const messages = await Session.messages({ sessionID: session.id })

    const manifest: TeleportManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: process.env.USER ?? process.env.USERNAME ?? "unknown",
      sourceDirectory: Instance.directory,
      session,
      messages: messages.map((m) => ({
        info: m.info,
        parts: m.parts,
      })),
      totalMessages: messages.length,
      totalParts: messages.reduce((s, m) => s + m.parts.length, 0),
    }

    const filePath =
      outputPath ??
      path.join(
        process.cwd(),
        `navi-session-${sessionID.slice(0, 8)}-${Date.now()}.navi-session`,
      )

    await Bun.write(filePath, JSON.stringify(manifest, null, 2))
    log.info("session exported", { sessionID, path: filePath, messages: manifest.totalMessages })

    return { path: filePath, manifest }
  }

  /**
   * Import a session from a .navi-session archive.
   * Creates a new session in the current project with all messages restored.
   */
  export async function importSession(filePath: string): Promise<{
    session: Session.Info
    messagesRestored: number
    partsRestored: number
  }> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      throw new Error(`Archive not found: ${filePath}`)
    }

    const manifest = await file.json() as TeleportManifest

    if (manifest.version !== 1) {
      throw new Error(`Unsupported archive version: ${manifest.version}`)
    }

    log.info("importing session", {
      sessionID: manifest.session.id,
      messages: manifest.totalMessages,
      exportedAt: manifest.exportedAt,
      exportedBy: manifest.exportedBy,
    })

    // Create a fresh session
    const newSession = await Session.create({
      title: `[Imported] ${manifest.session.title}`,
    })

    // Build ID mapping: old IDs → new IDs
    const messageIdMap = new Map<string, MessageID>()

    let messagesRestored = 0
    let partsRestored = 0

    // Restore messages in order
    for (const { info, parts } of manifest.messages) {
      const newMsgId = info.role === "user" ? MessageID.ascending() : MessageID.ascending()
      messageIdMap.set(info.id, newMsgId)

      // Remap parentID for assistant messages
      const parentID =
        info.role === "assistant" && info.parentID
          ? messageIdMap.get(info.parentID)
          : undefined

      // Restore the message
      const restoredMsg: MessageV2.Info = {
        ...info,
        id: newMsgId,
        sessionID: newSession.id,
        ...(parentID ? { parentID } : {}),
      }

      // Use SyncEvent-based update via Session.updateMessage equivalent
      try {
        const { SyncEvent } = await import("../sync")
        const { MessageV2: MV2 } = await import("./message-v2")
        SyncEvent.run(MV2.Event.Updated, { sessionID: newSession.id, info: restoredMsg })
        messagesRestored++

        // Restore parts
        for (const part of parts) {
          const restoredPart: MessageV2.Part = {
            ...part,
            id: PartID.ascending(),
            messageID: newMsgId,
            sessionID: newSession.id,
          }
          SyncEvent.run(MV2.Event.PartUpdated, {
            sessionID: newSession.id,
            part: restoredPart,
            time: Date.now(),
          })
          partsRestored++
        }
      } catch (err) {
        log.error("failed to restore message", { msgId: info.id, err })
      }
    }

    log.info("session imported", { newSessionID: newSession.id, messagesRestored, partsRestored })
    return { session: newSession, messagesRestored, partsRestored }
  }

  /**
   * List available .navi-session archives in a directory.
   */
  export async function listArchives(dir?: string): Promise<{
    path: string
    exportedAt: string
    title: string
    messages: number
  }[]> {
    const searchDir = dir ?? process.cwd()
    const results: { path: string; exportedAt: string; title: string; messages: number }[] = []

    try {
      const glob = new Bun.Glob("*.navi-session")
      for await (const file of glob.scan({ cwd: searchDir, absolute: true })) {
        try {
          const manifest = await Bun.file(file).json() as TeleportManifest
          results.push({
            path: file,
            exportedAt: manifest.exportedAt,
            title: manifest.session.title,
            messages: manifest.totalMessages,
          })
        } catch {
          // Skip malformed archives
        }
      }
    } catch {
      // Directory not accessible
    }

    return results
  }

  /**
   * Format an export receipt for display.
   */
  export function formatExportReceipt(result: { path: string; manifest: TeleportManifest }): string {
    const { path: filePath, manifest } = result
    return [
      `✅ Session exported successfully.`,
      ``,
      `**Archive**: ${filePath}`,
      `**Session**: ${manifest.session.title}`,
      `**Messages**: ${manifest.totalMessages}`,
      `**Parts**: ${manifest.totalParts}`,
      `**Exported at**: ${manifest.exportedAt}`,
      ``,
      `To import on another machine:`,
      `\`/teleport import ${filePath}\``,
    ].join("\n")
  }
}
