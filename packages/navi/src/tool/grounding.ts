import z from "zod";
import { Tool } from "./tool";
import { searchService } from "../search/service";

export const GroundingTool = Tool.define("grounding", {
  description: "Verify a claim or factual statement by searching the web. Returns search results that either support or potentially contradict the statement.",
  parameters: z.object({
    claim: z.string().describe("The statement or claim to verify"),
    context: z.string().optional().describe("Additional context to help refine the search"),
  }),
  async execute(params, ctx) {
    const searchQuery = `${params.claim} ${params.context || ""}`.trim();

    await ctx.ask({
      permission: "websearch",
      patterns: [searchQuery],
      always: ["*"],
      metadata: { claim: params.claim, context: params.context },
    });

    const results = await searchService.search({
      text: searchQuery,
      limit: 5,
    });

    if (results.length === 0) {
      return {
        output: "No grounding information found for the specified claim.",
        title: `Grounding: ${params.claim}`,
        metadata: { sourceCount: 0 },
      };
    }

    const output = `Grounding results for: "${params.claim}"\n\n` +
      results.map((r, i) => {
        let entry = `${i + 1}. [${r.title}](${r.url})\n`;
        if (r.snippet) entry += `   ${r.snippet}\n`;
        return entry;
      }).join("\n");

    return {
      output,
      title: `Grounding: ${params.claim}`,
      metadata: { sourceCount: results.length },
    };
  },
});
