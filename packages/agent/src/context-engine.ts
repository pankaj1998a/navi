import { Message, TokenUsage } from "./types";

/**
 * Abstract base class for pluggable context engines.
 * Context engines are responsible for tracking token usage and 
 * compressing the message history when it exceeds the token budget.
 */
export abstract class ContextEngine {
  /**
   * Update tracked token usage from an API response.
   */
  abstract updateFromResponse(usage: TokenUsage): void;

  /**
   * Return true if compaction should fire this turn.
   */
  abstract shouldCompress(promptTokens?: number): boolean;

  /**
   * Compact the message list and return the new message list.
   */
  abstract compress(messages: Message[], currentTokens?: number): Message[];

  /**
   * Hook called when a new session starts.
   */
  onSessionStart(sessionId: string): void {}

  /**
   * Hook called when a session ends.
   */
  onSessionEnd(messages: Message[]): void {}
}
