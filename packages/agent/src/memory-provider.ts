import { ToolSchema } from "./types";

/**
 * Interface for memory providers.
 * Memory providers can prefetch context based on a query 
 * and sync turns back to their storage.
 */
export interface MemoryProvider {
  /**
   * Unique name of the provider.
   */
  readonly name: string;

  /**
   * Returns a system prompt block that describes this memory source.
   */
  systemPromptBlock?(): string;

  /**
   * Prefetch context relevant to the query.
   */
  prefetch(query: string, sessionId?: string): Promise<string>;

  /**
   * Sync a completed conversation turn to the provider.
   */
  syncTurn(
    userContent: string,
    assistantContent: string,
    sessionId?: string
  ): Promise<void>;

  /**
   * Optional tools provided by this memory source.
   */
  getToolSchemas?(): ToolSchema[];
}
