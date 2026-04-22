import z from "zod"
import { Tool } from "./tool"
import { MemoryManager } from "../agent/memory-manager"

/**
 * MemoryQueryTool — Search tiered agent memory.
 */
export const MemoryQueryTool = Tool.define("memory_search", {
  description: `Search the agent's memory tiers (short, medium, long) for past context, architecture decisions, and learning.
Use this to recall details from previous sessions or find patterns in historical data.`,

  parameters: z.object({
    query: z.string().describe("The search query or concept to find in memory."),
    limit: z.number().optional().default(5).describe("Maximum number of results to return"),
    tier: z.enum(["short", "medium", "long"]).optional().describe("Specific tier to search"),
  }),

  async execute(params, _ctx) {
    // MemoryManager is a namespace, call static search directly
    const results = await MemoryManager.search(params.query, { 
      limit: params.limit, 
      tier: params.tier as any 
    })

    const output = results.length > 0
      ? results.map((r: MemoryManager.MemoryEntry) => `[${r.tier}] ${r.content}`).join("\n---\n")
      : "No relevant memories found for this query."

    return {
      title: `Memory Search: "${params.query}"`,
      output: `Found ${results.length} memories:\n\n${output}`,
      metadata: { count: results.length } as Record<string, any>
    }
  },
})
