import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"
import fsp from "fs/promises"
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

// Cached metadata index (TTL 5s) to avoid re-scanning + re-parsing on every list/search.
// Invalidated on save. Concurrency for per-item reads is capped at 8.
const metaIndexCache = new Map<string, { at: number; items: KIMetadata[] }>()
const META_INDEX_TTL_MS = 5_000
const META_READ_CONCURRENCY = 8

const readMetaSafe = (metaPath: string): Effect.Effect<KIMetadata | undefined> =>
  Effect.promise(() =>
    fsp.readFile(metaPath, "utf-8").then(
      (text): KIMetadata | undefined => {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          return undefined
        }
        return isKIMetadata(parsed) ? parsed : undefined
      },
      (): KIMetadata | undefined => undefined,
    ),
  )

function isKIMetadata(value: unknown): value is KIMetadata {
  if (typeof value !== "object" || value === null) return false
  if (!("id" in value && "title" in value && "summary" in value && "tags" in value && "updatedAt" in value))
    return false
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.tags) &&
    typeof value.updatedAt === "string"
  )
}

const listMetadata = Effect.fnUntraced(function* (kiDir: string) {
  const now = Date.now()
  const hit = metaIndexCache.get(kiDir)
  if (hit && now - hit.at < META_INDEX_TTL_MS) return hit.items
  const entries = yield* Effect.promise(() => fsp.readdir(kiDir, { withFileTypes: true }).catch(() => [] as import("fs").Dirent[]))
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  const items = (
    yield* Effect.forEach(
      dirs,
      (name) => readMetaSafe(path.join(kiDir, name, "metadata.json")),
      { concurrency: META_READ_CONCURRENCY },
    )
  ).filter((x): x is KIMetadata => x !== undefined)
  metaIndexCache.set(kiDir, { at: now, items })
  return items
})

const invalidateMetaIndex = (kiDir: string) => metaIndexCache.delete(kiDir)

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
              const items = yield* listMetadata(kiDir)

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

              const metaExists = yield* Effect.promise(() =>
                fsp
                  .stat(metaPath)
                  .then(() => true)
                  .catch(() => false),
              )
              if (!targetId || !metaExists) {
                // Fallback: search by title over cached index
                const items = yield* listMetadata(kiDir)
                for (const data of items) {
                  if (
                    (params.title && data.title.toLowerCase().includes(params.title.toLowerCase())) ||
                    (params.id && data.id.toLowerCase().includes(params.id.toLowerCase()))
                  ) {
                    const article = yield* Effect.promise(() =>
                      fsp.readFile(path.join(kiDir, data.id, "article.md"), "utf-8").catch(() => ""),
                    )
                    return {
                      title: `Knowledge: ${data.title}`,
                      output: `# ${data.title}\n\n> [!NOTE]\n> **Summary**: ${data.summary}\n\n${article}`,
                      metadata: { id: data.id } as Record<string, unknown>,
                    }
                  }
                }
                throw new Error(`Knowledge item not found for id/title: "${params.id || params.title}"`)
              }

              const meta = yield* readMetaSafe(metaPath)
              if (!meta) throw new Error(`Knowledge item not found for id/title: "${params.id || params.title}"`)
              const content = yield* Effect.promise(() => fsp.readFile(docPath, "utf-8").catch(() => ""))

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
              yield* Effect.promise(() => fsp.mkdir(itemDir, { recursive: true }))

              const meta: KIMetadata = {
                id: cleanId,
                title: params.title,
                summary: params.summary || params.content.slice(0, 150).replace(/\n/g, " "),
                tags: params.tags ? Array.from(params.tags) : [],
                updatedAt: new Date().toISOString(),
              }

              // Atomic writes (tmp+rename) so concurrent readers never see partial JSON.
              const writeAtomic = (file: string, data: string) =>
                Effect.promise(async () => {
                  const tmp = `${file}.${process.pid}.tmp`
                  await fsp.writeFile(tmp, data, "utf-8")
                  await fsp.rename(tmp, file)
                })
              yield* writeAtomic(path.join(itemDir, "metadata.json"), JSON.stringify(meta, null, 2))
              yield* writeAtomic(path.join(itemDir, "article.md"), params.content)
              invalidateMetaIndex(kiDir)

              return {
                title: `Saved knowledge ${meta.title}`,
                output: `✅ Knowledge item **${meta.title}** (\`${cleanId}\`) persisted to \`.navi/knowledge/${cleanId}/\`.`,
                metadata: { id: cleanId } as Record<string, unknown>,
              }
            }

            case "search": {
              const q = (params.query || "").toLowerCase()
              const items = yield* listMetadata(kiDir)
              // Article bodies read with capped concurrency (8); skip bodies when query matches metadata.
              const matched: KIMetadata[] = (
                yield* Effect.forEach(
                  items,
                  (data) =>
                    Effect.gen(function* () {
                      if (
                        data.title.toLowerCase().includes(q) ||
                        data.summary.toLowerCase().includes(q) ||
                        data.tags.some((t) => t.toLowerCase().includes(q))
                      )
                        return data
                      const article = (
                        yield* Effect.promise(() =>
                          fsp.readFile(path.join(kiDir, data.id, "article.md"), "utf-8").catch(() => ""),
                        )
                      ).toLowerCase()
                      if (article.includes(q)) return data
                      return undefined
                    }),
                  { concurrency: META_READ_CONCURRENCY },
                )
              ).filter((x): x is KIMetadata => x !== undefined)

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
