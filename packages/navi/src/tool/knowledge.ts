import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
import DESCRIPTION from "./knowledge.txt"

const log = Log.create({ service: "tool.knowledge" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "read", "save", "search"]).annotate({
    description: "The knowledge action to perform: 'list', 'read', 'save', or 'search'",
  }),
  id: Schema.optional(Schema.String).annotate({
    description: "Unique identifier for the knowledge item (e.g. 'auth_architecture', 'db_schema_v2')",
  }),
  title: Schema.optional(Schema.String).annotate({
    description: "Human-readable title of the knowledge item (for 'save' or 'read')",
  }),
  summary: Schema.optional(Schema.String).annotate({
    description: "Short 1-2 sentence executive summary of the knowledge item",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "Full markdown content, code patterns, or diagrams to persist",
  }),
  tags: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Keywords or subsystem tags (e.g. ['auth', 'session', 'database'])",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query for finding relevant knowledge items (for 'search')",
  }),
})

type KIMetadata = {
  id: string
  title: string
  summary: string
  tags: string[]
  updatedAt: string
}

function getKnowledgeDir(worktree: string): string {
  const dir = path.join(worktree, ".navi", "knowledge")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export const KnowledgeTool = Tool.define(
  "knowledge",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const kiDir = getKnowledgeDir(instance.directory)

          yield* ctx.ask({
            permission: "knowledge",
            patterns: [params.action, params.id ?? "*"],
            always: ["*"],
            metadata: {
              action: params.action,
              id: params.id,
              title: params.title,
            },
          })

          switch (params.action) {
            case "list": {
              const items: KIMetadata[] = []
              const entries = fs.readdirSync(kiDir, { withFileTypes: true })
              for (const entry of entries) {
                if (entry.isDirectory()) {
                  const metaPath = path.join(kiDir, entry.name, "metadata.json")
                  if (fs.existsSync(metaPath)) {
                    try {
                      const data = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as KIMetadata
                      items.push(data)
                    } catch {
                      // ignore corrupt item
                    }
                  }
                }
              }

              if (items.length === 0) {
                return {
                  title: "Knowledge Items (0)",
                  output: "No knowledge items currently saved in `.navi/knowledge/`.\nUse `knowledge` with action `save` to document architecture and patterns.",
                  metadata: { count: 0 } as Record<string, unknown>,
                }
              }

              const formatted = items
                .map(
                  (item) =>
                    `### 🧠 **${item.title}** (\`${item.id}\`)\n- **Summary**: ${item.summary}\n- **Tags**: ${item.tags.length ? item.tags.map((t) => `\`${t}\``).join(", ") : "None"}\n- **Updated**: ${new Date(item.updatedAt).toLocaleString()}`,
                )
                .join("\n\n")

              return {
                title: `Knowledge Items (${items.length})`,
                output: `# Repository Knowledge Items\n\n${formatted}`,
                metadata: { count: items.length } as Record<string, unknown>,
              }
            }

            case "read": {
              if (!params.id && !params.title) {
                throw new Error("Either 'id' or 'title' is required for action 'read'")
              }

              const targetId = params.id ? params.id.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase() : ""
              const itemDir = path.join(kiDir, targetId)
              const metaPath = path.join(itemDir, "metadata.json")
              const docPath = path.join(itemDir, "article.md")

              if (!fs.existsSync(itemDir) || !fs.existsSync(metaPath)) {
                // Fallback: search by title
                const entries = fs.readdirSync(kiDir, { withFileTypes: true })
                for (const entry of entries) {
                  if (entry.isDirectory()) {
                    const mp = path.join(kiDir, entry.name, "metadata.json")
                    if (fs.existsSync(mp)) {
                      try {
                        const data = JSON.parse(fs.readFileSync(mp, "utf-8")) as KIMetadata
                        if (
                          (params.title && data.title.toLowerCase().includes(params.title.toLowerCase())) ||
                          (params.id && data.id.toLowerCase().includes(params.id.toLowerCase()))
                        ) {
                          const article = fs.existsSync(path.join(kiDir, entry.name, "article.md"))
                            ? fs.readFileSync(path.join(kiDir, entry.name, "article.md"), "utf-8")
                            : ""
                          return {
                            title: `Knowledge: ${data.title}`,
                            output: `# ${data.title}\n\n> [!NOTE]\n> **Summary**: ${data.summary}\n\n${article}`,
                            metadata: { id: data.id } as Record<string, unknown>,
                          }
                        }
                      } catch {}
                    }
                  }
                }
                throw new Error(`Knowledge item not found for id/title: "${params.id || params.title}"`)
              }

              const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as KIMetadata
              const content = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf-8") : ""

              return {
                title: `Knowledge: ${meta.title}`,
                output: `# ${meta.title}\n\n> [!NOTE]\n> **Summary**: ${meta.summary}\n\n${content}`,
                metadata: { id: meta.id } as Record<string, unknown>,
              }
            }

            case "save": {
              if (!params.title) throw new Error("Parameter 'title' is required for action 'save'")
              if (!params.content) throw new Error("Parameter 'content' is required for action 'save'")

              const cleanId = (params.id || params.title).replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
              const itemDir = path.join(kiDir, cleanId)
              if (!fs.existsSync(itemDir)) {
                fs.mkdirSync(itemDir, { recursive: true })
              }

              const meta: KIMetadata = {
                id: cleanId,
                title: params.title,
                summary: params.summary || params.content.slice(0, 150).replace(/\n/g, " "),
                tags: params.tags ? Array.from(params.tags) : [],
                updatedAt: new Date().toISOString(),
              }

              fs.writeFileSync(path.join(itemDir, "metadata.json"), JSON.stringify(meta, null, 2), "utf-8")
              fs.writeFileSync(path.join(itemDir, "article.md"), params.content, "utf-8")

              return {
                title: `Saved knowledge ${meta.title}`,
                output: `✅ Knowledge item **${meta.title}** (\`${cleanId}\`) persisted to \`.navi/knowledge/${cleanId}/\`.`,
                metadata: { id: cleanId } as Record<string, unknown>,
              }
            }

            case "search": {
              const q = (params.query || "").toLowerCase()
              const matched: KIMetadata[] = []
              const entries = fs.readdirSync(kiDir, { withFileTypes: true })
              for (const entry of entries) {
                if (entry.isDirectory()) {
                  const metaPath = path.join(kiDir, entry.name, "metadata.json")
                  if (fs.existsSync(metaPath)) {
                    try {
                      const data = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as KIMetadata
                      const article = fs.existsSync(path.join(kiDir, entry.name, "article.md"))
                        ? fs.readFileSync(path.join(kiDir, entry.name, "article.md"), "utf-8").toLowerCase()
                        : ""
                      if (
                        data.title.toLowerCase().includes(q) ||
                        data.summary.toLowerCase().includes(q) ||
                        data.tags.some((t) => t.toLowerCase().includes(q)) ||
                        article.includes(q)
                      ) {
                        matched.push(data)
                      }
                    } catch {}
                  }
                }
              }

              if (matched.length === 0) {
                return {
                  title: `Knowledge Search: "${params.query}" (0 matches)`,
                  output: `No knowledge items found matching "${params.query}".`,
                  metadata: { count: 0 } as Record<string, unknown>,
                }
              }

              const resultText = matched
                .map(
                  (m) =>
                    `### 🧠 **${m.title}** (\`${m.id}\`)\n- **Summary**: ${m.summary}\n- **Tags**: ${m.tags.join(", ")}`,
                )
                .join("\n\n")

              return {
                title: `Knowledge Search (${matched.length} matches)`,
                output: `# Matches for "${params.query}":\n\n${resultText}`,
                metadata: { count: matched.length } as Record<string, unknown>,
              }
            }

            default:
              throw new Error(`Unknown knowledge action: ${params.action}`)
          }
        }),
    }
  }),
)
