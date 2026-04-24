import { Token } from "./token"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"

export namespace TokenEstimator {
  /**
   * More accurate token estimation based on character count and content type.
   * Handles code and prose differently.
   */
  export function estimate(text: string, options: { isCode?: boolean } = {}): number {
    if (!text) return 0
    
    // Basic heuristic: 4 chars per token for prose, ~3 for code
    const charsPerToken = options.isCode ? 3.2 : 4
    let estimated = Math.ceil(text.length / charsPerToken)

    // Adjust for common patterns
    const lines = text.split("\n").length
    estimated += lines // Each newline is at least one token

    return estimated
  }

  /**
   * Estimate cost of tokens for a given model.
   */
  export async function estimateCost(tokens: { input: number; output: number }, modelID: string): Promise<number> {
    const model = await Provider.parseModel(modelID)
    const info = await Provider.getModel(model.providerID, model.modelID)
    
    if (!info.cost) return 0
    
    const inputCost = (tokens.input / 1_000_000) * (info.cost.input || 0)
    const outputCost = (tokens.output / 1_000_000) * (info.cost.output || 0)
    
    return inputCost + outputCost
  }
}



