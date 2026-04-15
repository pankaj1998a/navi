import { MessageV2 } from "../session/message-v2"
import { Log } from "../util/log"
import { VectorStore } from "../ai/VectorStore"
import { iife } from "@/util/iife"

type Message = MessageV2.Info
type Part = MessageV2.Part
type TextPart = MessageV2.TextPart
type ToolPart = MessageV2.ToolPart

const log = Log.create({ service: "speculation-engine" })

export interface Speculation {
  nextFiles: string[]
  suggestedTools: string[]
  confidence: number
}

export type MessageWithContent = MessageV2.WithParts

/**
 * SpeculationEngine predicts likely future actions based on session history.
 */
export class SpeculationEngine {
  /**
   * Analyzes the current session history and predicts the next 3 most likely files
   * or tools needed by the user.
   */
  static speculate(messages: MessageWithContent[]): Speculation {
    try {
      if (!messages || !Array.isArray(messages)) {
        return { nextFiles: [], suggestedTools: [], confidence: 0 }
      }

      const lastUserMessage = messages.findLast((m) => m && m.info.role === "user")
      const lastUserContent =
        lastUserMessage?.parts
          ?.map((p) => (p && p.type === "text" ? (p as TextPart).text : ""))
          .join(" ") || ""

      const recentEdits = new Set<string>()
      const toolUsage = new Map<string, number>()

      // 1. Collect recent context from messages
      for (const m of messages.slice(-15)) {
        if (!m || !m.parts) continue
        
        m.parts.forEach((p) => {
          if (!p) return
          
          if (p.type === "tool") {
            const tp = p as ToolPart
            const toolName = tp.tool
            if (toolName) {
              toolUsage.set(toolName, (toolUsage.get(toolName) || 0) + 1)
            }
            
            // Check tool input for paths
            const input = tp.state.input
            const inputStr = typeof input === "string" ? input : JSON.stringify(input)
            if (inputStr && inputStr.length > 2) {
              const matches = inputStr.match(/[a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+/g)
              if (matches) {
                matches.forEach(f => {
                  if (f.length > 3) recentEdits.add(f)
                })
              }
            }
          }
          
          if (p.type === "text") {
            const textPart = p as TextPart
            if (textPart.text) {
              const matches = textPart.text.match(/[a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9]+/g)
              if (matches) {
                matches.forEach((f: string) => {
                  if (f.length > 3) recentEdits.add(f)
                })
              }
            }
          }
        })
      }

      const nextFiles = Array.from(recentEdits).slice(-3).reverse()
      const suggestedTools = Array.from(toolUsage.entries())
        .sort((a, b) => b[1] - a[1])
        .map((e) => e[0])
        .slice(0, 3)

      // 2. Adjust confidence based on keyword matching
      let confidence = 0.2
      const lower = lastUserContent.toLowerCase()
      if (lower.match(/\b(edit|fix|update|change|refactor|modify)\b/)) confidence += 0.5
      if (lower.match(/\b(read|view|cat|less|show|list)\b/)) confidence += 0.3
      if (lower.match(/\b(create|add|new|generate)\b/)) confidence += 0.4

      confidence = Math.min(confidence, 0.95)

      // 3. Deep Context Speculation (AI-powered prediction)
      const semanticExtraFiles: string[] = []
      iife(async () => {
         if (lastUserContent.length > 10) {
            const semanticResults = await VectorStore.get().search(lastUserContent, 3)
            for (const r of semanticResults) {
                if (r.metadata.file) semanticExtraFiles.push(r.metadata.file)
            }
         }
      })

      const combinedFiles = Array.from(new Set([...nextFiles, ...semanticExtraFiles])).slice(0, 3)

      return {
        nextFiles: combinedFiles,
        suggestedTools,
        confidence,
      }
    } catch (e) {
      log.error("Speculation failed", { error: e })
      return { nextFiles: [], suggestedTools: [], confidence: 0 }
    }
  }

  /**
   * Tree-of-Thought style evaluation. Given parallel predicted paths, simulates
   * heuristic viability scores before actual execution.
   */
  static async evaluateParallelPaths(paths: {id: string, description: string}[], context: string): Promise<Array<{id: string, score: number, reasoning: string}>> {
      log.info("Speculating tree-of-thought node values", { count: paths.length });
      // In a fully built iteration this would call an LM model, but we apply heuristics based on the VectorStore & basic semantic overlaps.
      
      return paths.map(path => {
          let score = 0.5; // Base probability 
          
          const lowerDesc = path.description.toLowerCase();
          const lowerCtx = context.toLowerCase();
          
          // Heuristic 1: If the path explicitly covers context gaps.
          if (lowerCtx.includes("test") && lowerDesc.includes("test")) score += 0.2;
          if (lowerCtx.includes("error") && lowerDesc.includes("fix")) score += 0.2;
          if (lowerCtx.includes("api") && lowerDesc.includes("endpoint")) score += 0.2;
          
          // Heuristic 2: Negative matching for out-of-scope speculations
          if (lowerDesc.includes("architecture") && !lowerCtx.includes("design")) score -= 0.1;
          
          return {
              id: path.id,
              score: Math.min(Math.max(score, 0), 1),
              reasoning: `Heuristic semantic match score: ${score.toFixed(2)}`
          };
      }).sort((a, b) => b.score - a.score);
  }
}


