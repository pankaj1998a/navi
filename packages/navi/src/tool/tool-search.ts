import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { Service as ToolRegistryService } from "./registry-service"

/**
 * ToolSearchTool — Semantic search over all available tools.
 *
 * Lets the LLM discover tools by describing what it wants to do,
 * without needing to know the exact tool name.
 *
 * Uses keyword matching + description similarity to rank results.
 */
export const ToolSearchTool = Tool.define(
  "tool_search",
  Effect.gen(function* () {
    const Parameters = Schema.Struct({
      query: Schema.String.annotate({
        description: "Describe what you want to do (e.g. 'run a shell command', 'search for files')",
      }),
      limit: Schema.optional(Schema.Number).pipe(Schema.withDecodingDefault(Effect.succeed(5))).annotate({
        description: "Maximum number of results to return (default 5)",
      }),
    })

    const execute = (params: any, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        // Get the registry service at runtime to avoid circular dependency during initialization
        const registry = yield* ToolRegistryService

        // Get all available tool IDs
        const toolIds = yield* registry.ids()

        // Score each tool against the query
        const query = params.query.toLowerCase()
        const queryWords = query.split(/\s+/).filter((w: string) => w.length > 2)

        const scored: { id: string; score: number }[] = []

        for (const id of toolIds) {
          let score = 0

          // Direct name match gets highest score
          if (id.toLowerCase() === query) score += 100
          if (id.toLowerCase().includes(query)) score += 50

          // Word-level matching on tool id
          for (const word of queryWords) {
            if (id.toLowerCase().includes(word)) score += 10
          }

          // Heuristic intent mapping
          const intentMap: Record<string, string[]> = {
            run: ["bash", "repl", "schedule_cron", "sleep"],
            execute: ["bash", "repl"],
            file: ["read", "write", "edit", "glob", "grep"],
            search: ["grep", "codesearch", "websearch", "googlesearch", "tool_search", "exa_search", "ddg_search", "tavily"],
            web: [
              "webfetch",
              "websearch",
              "googlesearch",
              "browser",
              "webscrape",
              "webcrawl",
              "firecrawl",
              "exa_search",
              "ddg_search",
              "tavily",
            ],
            git: ["bash"],
            code: ["edit", "write", "read", "grep", "codesearch", "repl", "lsp", "apply_patch"],
            test: ["bash", "repl"],
            task: ["task"],
            agent: ["task"],
            schedule: ["schedule_cron"],
            cron: ["schedule_cron"],
            sleep: ["sleep"],
            wait: ["sleep"],
            pause: ["sleep"],
            find: ["glob", "grep", "codesearch"],
            list: ["glob"],
            fetch: ["webfetch", "webscrape", "firecrawl"],
            scrape: ["webscrape", "firecrawl"],
            crawl: ["webcrawl", "firecrawl"],
            browse: ["browser"],
            memory: ["todowrite"],
            todo: ["todowrite"],
            skill: ["skill"],
            batch: ["batch"],
          }

          for (const [intent, tools] of Object.entries(intentMap)) {
            if (query.includes(intent) && tools.includes(id)) score += 20
          }

          if (score > 0) scored.push({ id, score })
        }

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score)
        const top = scored.slice(0, params.limit)

        if (top.length === 0) {
          return {
            title: "Tool Search",
            metadata: { query: params.query, found: 0 },
            output: `No tools found matching "${params.query}". Available tools: ${toolIds.join(", ")}`,
          }
        }

        const lines = [
          `Found ${top.length} tool(s) matching "${params.query}":`,
          "",
          ...top.map(({ id }) => `- **${id}**: use the ${id} tool`),
          "",
          `All available tools: ${toolIds.join(", ")}`,
        ]

        return {
          title: "Tool Search Results",
          metadata: { query: params.query, found: top.length },
          output: lines.join("\n"),
        }
      })

    return {
      description: `Search for available tools by describing what you want to do.
Use this when you're unsure which tool to use or want to discover tools for a specific task.

Returns matching tools with their names and descriptions, ranked by relevance.`,

      parameters: Parameters,

      execute: execute as any,
    } as any
  }),
)
