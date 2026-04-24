import z from "zod"
import { Tool } from "./tool"
import { SessionTeleport } from "../session/teleport"

/**
 * TeleportTool — Export/import sessions as portable archives.
 *
 * Enables seamless session migration:
 * - Export your session → share the archive
 * - Import on another machine → continue exactly where you left off
 */
export const TeleportTool = Tool.define("teleport", {
  description: `Export or import sessions as portable .navi-session archives for cross-machine session migration.

Operations:
- **export**: Save the current/specified session to a portable archive file
- **import**: Restore a session from a .navi-session archive file
- **list**: Scan a directory for available .navi-session archives

Use cases:
- Continue a session on a different machine
- Share a session state with a teammate
- Backup important session context
- Transfer sessions between local and CI environments`,

  parameters: z.object({
    operation: z.enum(["export", "import", "list"]).describe("Operation to perform"),
    session_id: z.string().optional().describe("Session ID to export (required for 'export')"),
    archive_path: z.string().optional().describe("Path to archive file (required for 'import', optional for 'export')"),
    directory: z.string().optional().describe("Directory to scan for archives (for 'list' operation)"),
  }),

  async execute(params, ctx) {
    const op = params.operation

    if (op === "export") {
      const sessionID = params.session_id ?? ctx.sessionID
      const result = await SessionTeleport.exportSession(sessionID, params.archive_path)
      return {
        title: "Session Exported",
        metadata: {},
        output: SessionTeleport.formatExportReceipt(result),
      }
    }

    if (op === "import") {
      if (!params.archive_path) throw new Error("archive_path is required for 'import' operation")
      const result = await SessionTeleport.importSession(params.archive_path)
      return {
        title: "Session Imported",
        metadata: {},
        output: [
          `✅ Session imported successfully.`,
          ``,
          `**New Session ID**: ${result.session.id}`,
          `**Title**: ${result.session.title}`,
          `**Messages restored**: ${result.messagesRestored}`,
          `**Parts restored**: ${result.partsRestored}`,
        ].join("\n"),
      }
    }

    // list
    const archives = await SessionTeleport.listArchives(params.directory)
    if (archives.length === 0) {
      return {
        title: "No Archives Found",
        metadata: {},
        output: `No .navi-session archives found in ${params.directory ?? process.cwd()}.`,
      }
    }

    const lines = [
      `Found ${archives.length} session archive(s):`,
      "",
      ...archives.map((a, i) =>
        [
          `**${i + 1}. ${a.title}**`,
          `   Path: ${a.path}`,
          `   Exported: ${new Date(a.exportedAt).toLocaleString()}`,
          `   Messages: ${a.messages}`,
        ].join("\n"),
      ),
    ]

    return {
      title: "Session Archives",
      metadata: {},
      output: lines.join("\n"),
    }
  },
})
