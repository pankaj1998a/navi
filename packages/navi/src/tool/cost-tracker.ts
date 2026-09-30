import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * CostTracker — stub service wrapping token estimation.
 * Mirrors Claude `src/services/tokenEstimation.ts` + `src/cost-tracker.ts`
 * and `src/utils/modelCost.ts`.
 *
 * Token estimation in Claude uses provider-specific counting:
 * - Anthropic countTokens, Bedrock CountTokensCommand, Vertex, etc.
 * This stub provides a deterministic heuristic (chars/4) plus optional
 * js-tiktoken hook, and a simple USD cost model.
 */

export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  // per million tokens — placeholder pricing, mirrors modelCost.ts structure
  "claude-4-sonnet": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-3.5-sonnet": { inputPerMTok: 3, outputPerMTok: 15 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "gemini-2.0-flash": { inputPerMTok: 0.075, outputPerMTok: 0.3 },
  default: { inputPerMTok: 3, outputPerMTok: 15 },
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  // Heuristic used when provider tokenizer unavailable — matches Claude TokenEstimation fallback
  return Math.ceil(text.length / 4)
}

export function estimateTokensForMessages(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0) + 2 // chat overhead
}

export function calculateCost(params: {
  inputTokens: number
  outputTokens: number
  model?: string
}): { inputCost: number; outputCost: number; total: number } {
  const pricing = MODEL_PRICING[params.model ?? "default"] ?? MODEL_PRICING["default"]!
  const inputCost = (params.inputTokens / 1_000_000) * pricing.inputPerMTok
  const outputCost = (params.outputTokens / 1_000_000) * pricing.outputPerMTok
  return { inputCost, outputCost, total: inputCost + outputCost }
}

export const CostTracker = {
  estimateTokens,
  estimateTokensForMessages,
  calculateCost,
  MODEL_PRICING,
}

export const Parameters = Schema.Struct({
  action: Schema.Literals(["estimate", "cost", "status"]).annotate({
    description: "CostTracker action: estimate tokens, calculate cost, or status",
  }),
  text: Schema.optional(Schema.String).annotate({ description: "Text to estimate tokens for (action 'estimate')" }),
  inputTokens: Schema.optional(Schema.Number).annotate({ description: "Input tokens for cost calc" }),
  outputTokens: Schema.optional(Schema.Number).annotate({ description: "Output tokens for cost calc" }),
  model: Schema.optional(Schema.String).annotate({ description: "Model id for pricing (e.g. claude-4-sonnet)" }),
})

const DESCRIPTION = [
  "CostTracker service wrapping token estimation — mirrors Claude `src/services/tokenEstimation.ts` and `src/cost-tracker.ts`.",
  "",
  "Provides pre-computation of prompt/tool token usage and real-time USD cost accounting for the active session.",
  "Full impl uses provider tokenizers (Anthropic countTokens, Bedrock, Vertex) and `calculateUSDCost` from `src/utils/modelCost.ts`.",
  "This stub uses heuristic chars/4 and placeholder pricing; swap to js-tiktoken / provider SDK when enabling.",
].join("\n")

export const CostTrackerTool = Tool.define(
  "cost_tracker",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "cost_tracker",
            patterns: [params.action],
            always: ["*"],
            metadata: { action: params.action, model: params.model },
          })

          switch (params.action) {
            case "estimate": {
              if (params.text === undefined) throw new Error("Parameter 'text' is required for action 'estimate'")
              const tokens = estimateTokens(params.text)
              return {
                title: `Tokens: ${tokens}`,
                output: `Estimated tokens: ${tokens}\nChars: ${params.text.length}\nHeuristic: ceil(chars/4)\nModel: ${params.model ?? "default"}\nFull impl: provider tokenizer (Anthropic/Bedrock/Vertex) with thinking budget aware counting.`,
                metadata: { tokens, chars: params.text.length } as Record<string, unknown>,
              }
            }
            case "cost": {
              const input = params.inputTokens ?? 0
              const output = params.outputTokens ?? 0
              const cost = calculateCost({ inputTokens: input, outputTokens: output, model: params.model })
              return {
                title: `Cost: $${cost.total.toFixed(4)}`,
                output: [
                  `Input:  ${input} tokens -> $${cost.inputCost.toFixed(6)}`,
                  `Output: ${output} tokens -> $${cost.outputCost.toFixed(6)}`,
                  `Total:  $${cost.total.toFixed(6)} (model: ${params.model ?? "default"})`,
                  `Pricing: ${JSON.stringify(MODEL_PRICING[params.model ?? "default"] ?? MODEL_PRICING["default"])} per MTok`,
                ].join("\n"),
                metadata: { ...cost, inputTokens: input, outputTokens: output } as Record<string, unknown>,
              }
            }
            case "status":
              return {
                title: "CostTracker status",
                output: [
                  "CostTracker: stub (heuristic)",
                  `Models: ${Object.keys(MODEL_PRICING).join(", ")}`,
                  "Full impl: addToTotalSessionCost, calculateUSDCost, DiagnosticTracking, Statsig",
                  "Estimate: Math.ceil(text.length/4) + 4 per message + 2 chat overhead (see estimateTokensForMessages)",
                ].join("\n"),
                metadata: { models: Object.keys(MODEL_PRICING) } as Record<string, unknown>,
              }
            default:
              throw new Error(`Unknown cost_tracker action: ${params.action}`)
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// Alias export for registry auto-discovery compatibility
export const CostTrackTool = CostTrackerTool
