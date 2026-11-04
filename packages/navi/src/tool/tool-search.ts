import { Effect, Schema } from "effect"
import { Tool } from "./tool"

/** Rank the caller's runtime catalog, including custom and MCP tools. */
export function searchTools(tools: ReadonlyArray<{ id: string; description: string }>, query: string, limit = 5) {
  const normalized = query.trim().toLowerCase()
  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  if (!words.length) return []
  return tools
    .map((tool) => {
      const name = tool.id.toLowerCase()
      const description = tool.description.toLowerCase()
      const score =
        (name === normalized ? 1000 : 0) +
        words.reduce((sum, word) => sum + (name.includes(word) ? 10 : 0) + (description.includes(word) ? 1 : 0), 0)
      return { ...tool, score }
    })
    .filter((tool) => tool.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, Math.min(20, Number.isFinite(limit) ? Math.trunc(limit) : 5)))
}

export const ToolSearchTool = Tool.define(
  "tool_search",
  Effect.gen(function* () {
    const Parameters = Schema.Struct({
      query: Schema.String.annotate({ description: "Describe the capability or exact tool name you need." }),
      limit: Schema.optional(Schema.Number)
        .pipe(Schema.withDecodingDefault(Effect.succeed(5)))
        .annotate({
          description: "Maximum results (1-20, default 5).",
        }),
    })
    return {
      description:
        "Discover tools by name or description in this session's runtime catalog. Includes permitted built-in, custom, and MCP tools. Search before assuming a capability is unavailable. Discovery does not grant permissions or verify external service readiness.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.sync(() => {
          const results = searchTools(ctx.availableTools ?? [], params.query, params.limit)
          return {
            title: "Tool Search Results",
            metadata: { query: params.query, found: results.length },
            output:
              ctx.availableTools === undefined
                ? "Runtime tool catalog is unavailable in this execution context. Consult the supplied tool definitions."
                : results.length === 0
                  ? `No available tools match "${params.query}". Try a different capability or exact tool name.`
                  : [
                      `Found ${results.length} available tool(s):`,
                      ...results.map((tool) => `- **${tool.id}**: ${tool.description}`),
                      "Use the supplied tool schema for arguments. Tool availability does not guarantee configured credentials or a running external service.",
                    ].join("\n"),
          }
        }),
    }
  }),
)
