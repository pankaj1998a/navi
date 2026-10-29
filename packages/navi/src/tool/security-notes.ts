import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { globalPentestNotes } from "@/security/notes"

const DESCRIPTION =
  "Collaborative cross-agent pentest blackboard notes. Share credentials, discovered tokens, attack chains, and target insights across the red team."

export const Parameters = Schema.Struct({
  action: Schema.Literals(["create", "update", "get", "list", "delete"]).annotate({
    description: "Action to perform: 'create', 'update', 'get', 'list', or 'delete'",
  }),
  note_id: Schema.optional(Schema.String).annotate({
    description: "Note ID (for 'get', 'update', or 'delete')",
  }),
  title: Schema.optional(Schema.String).annotate({
    description: "Note title (for 'create' or 'update')",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "Note markdown content (for 'create' or 'update')",
  }),
  tags: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Tags for categorization (e.g. ['creds', 'jwt', 'admin', 'sqli'])",
  }),
  filter_tag: Schema.optional(Schema.String).annotate({
    description: "Filter tag for action 'list'",
  }),
})

export const SecurityNotesTool = Tool.define(
  "security_notes",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "list") {
            const list = globalPentestNotes.list(params.filter_tag)
            return {
              title: "Pentest Shared Notes",
              output: JSON.stringify(list, null, 2),
              metadata: { total: list.length } as Record<string, unknown>,
            }
          }

          if (params.action === "get") {
            if (!params.note_id) {
              return {
                title: "Get Note Error",
                output: "Error: 'note_id' is required for action 'get'",
                metadata: { found: false } as Record<string, unknown>,
              }
            }
            const note = globalPentestNotes.get(params.note_id)
            if (!note) {
              return {
                title: "Note Not Found",
                output: `Note ${params.note_id} not found on blackboard.`,
                metadata: { found: false } as Record<string, unknown>,
              }
            }
            return {
              title: `Note: ${note.title} (${note.id})`,
              output: [`# ${note.title}`, `Tags: ${note.tags.join(", ")}`, `Author: ${note.author}`, "", note.content].join("\n"),
              metadata: { found: true, id: note.id } as Record<string, unknown>,
            }
          }

          if (params.action === "create") {
            if (!params.title || !params.content) {
              return {
                title: "Create Note Error",
                output: "Error: 'title' and 'content' are required for action 'create'",
                metadata: { created: false } as Record<string, unknown>,
              }
            }
            const note = globalPentestNotes.create(
              params.title,
              params.content,
              params.tags ? [...params.tags] : [],
            )
            return {
              title: `Created Note (${note.id})`,
              output: `✅ Note "${note.title}" created on shared blackboard. ID: \`${note.id}\``,
              metadata: { created: true, id: note.id } as Record<string, unknown>,
            }
          }

          if (params.action === "update") {
            if (!params.note_id) {
              return {
                title: "Update Note Error",
                output: "Error: 'note_id' is required for action 'update'",
                metadata: { updated: false } as Record<string, unknown>,
              }
            }
            const updated = globalPentestNotes.update(params.note_id, {
              title: params.title,
              content: params.content,
              tags: params.tags ? [...params.tags] : undefined,
            })
            if (!updated) {
              return {
                title: "Note Not Found",
                output: `Note ${params.note_id} not found to update.`,
                metadata: { updated: false } as Record<string, unknown>,
              }
            }
            return {
              title: `Updated Note (${updated.id})`,
              output: `✅ Note \`${updated.id}\` ("${updated.title}") updated successfully.`,
              metadata: { updated: true, id: updated.id } as Record<string, unknown>,
            }
          }

          if (params.action === "delete") {
            if (!params.note_id) {
              return {
                title: "Delete Note Error",
                output: "Error: 'note_id' is required for action 'delete'",
                metadata: { deleted: false } as Record<string, unknown>,
              }
            }
            const deleted = globalPentestNotes.delete(params.note_id)
            return {
              title: "Delete Note",
              output: deleted ? `✅ Note \`${params.note_id}\` removed from blackboard.` : `Note ${params.note_id} not found.`,
              metadata: { deleted } as Record<string, unknown>,
            }
          }

          return {
            title: "Security Notes Tool",
            output: `Unknown action: ${params.action}`,
            metadata: {} as Record<string, unknown>,
          }
        }),
    }
  }),
)
