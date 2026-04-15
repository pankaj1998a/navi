import { ContextEngine } from "./context-engine";
import { Message, TokenUsage } from "./types";

/**
 * Default implementation of context compression.
 * Implements pruning and basic summarization strategies.
 */
export class ContextCompressor extends ContextEngine {
  private lastUsage?: TokenUsage;
  private maxTokens: number;
  private tailProtection: number;

  constructor(maxTokens = 32000, tailProtection = 8000) {
    super();
    this.maxTokens = maxTokens;
    this.tailProtection = tailProtection;
  }

  updateFromResponse(usage: TokenUsage): void {
    this.lastUsage = usage;
  }

  /**
   * Check if compression is needed based on the current token usage.
   */
  shouldCompress(promptTokens?: number): boolean {
    const tokens = promptTokens || (this.lastUsage ? this.lastUsage.promptTokens : 0);
    return tokens > this.maxTokens;
  }

  /**
   * Compresses the message history.
   * Currently implements a simple head/tail preservation strategy.
   * Future versions can include tool result pruning and iterative summarization.
   */
  compress(messages: Message[], currentTokens?: number): Message[] {
    if (messages.length <= 10) return messages;

    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    // Head protection (usually system prompt + maybe the very first user message)
    // Tail protection (the most recent messages)
    const tailMessages = otherMessages.slice(-8);

    const result: Message[] = [...systemMessages];
    
    if (otherMessages.length > tailMessages.length) {
      result.push({
        role: "system",
        content: "[Context was compressed to save tokens. Some older messages were removed.]",
      });
    }

    result.push(...tailMessages);
    return result;
  }

  /**
   * Prune tool results to save tokens.
   * Replaces large tool outputs with a placeholder.
   */
  private pruneToolResults(messages: Message[]): Message[] {
    return messages.map((m, i) => {
      if (m.role === "tool" && m.content.length > 1000 && i < messages.length - 2) {
        return {
          ...m,
          content: "(Large tool output truncated for context efficiency)",
        };
      }
      return m;
    });
  }
}
