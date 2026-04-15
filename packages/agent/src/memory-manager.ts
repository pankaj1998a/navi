import { MemoryProvider } from "./memory-provider";
import { ToolSchema } from "./types";

/**
 * Orchestrates multiple memory providers.
 * Collects context and syncs turns across all registered sources.
 */
export class MemoryManager {
  private providers: MemoryProvider[] = [];

  /**
   * Register a new memory provider.
   */
  addProvider(provider: MemoryProvider): void {
    this.providers.push(provider);
  }

  /**
   * Collect system prompt blocks from all providers.
   */
  getSystemPromptBlocks(): string[] {
    return this.providers
      .map((p) => (p.systemPromptBlock ? p.systemPromptBlock() : ""))
      .filter((b) => b.length > 0);
  }

  /**
   * Collect prefetch context from all providers based on a query.
   */
  async prefetchAll(query: string, sessionId?: string): Promise<string> {
    const results = await Promise.all(
      this.providers.map(async (p) => {
        try {
          return await p.prefetch(query, sessionId);
        } catch (error) {
          console.error(`Memory provider ${p.name} prefetch failed:`, error);
          return "";
        }
      })
    );
    return results.filter((r) => r.length > 0).join("\n\n");
  }

  /**
   * Sync a turn to all registered memory providers.
   */
  async syncAll(
    userContent: string,
    assistantContent: string,
    sessionId?: string
  ): Promise<void> {
    await Promise.all(
      this.providers.map(async (p) => {
        try {
          await p.syncTurn(userContent, assistantContent, sessionId);
        } catch (error) {
          console.error(`Memory provider ${p.name} sync fail:`, error);
        }
      })
    );
  }

  /**
   * Collect tool schemas from all providers.
   */
  getAllToolSchemas(): ToolSchema[] {
    const tools: ToolSchema[] = [];
    for (const provider of this.providers) {
      if (provider.getToolSchemas) {
        tools.push(...provider.getToolSchemas());
      }
    }
    return tools;
  }
}
