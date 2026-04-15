import { Message, AgentConfig, TokenUsage, ModelConfig } from "./types";
import { ContextEngine } from "./context-engine";
import { ContextCompressor } from "./context-compressor";

export interface CompletionFnOptions {
  messages: Message[];
  model: ModelConfig;
  temperature?: number;
  topP?: number;
  tools?: any[];
}

export interface CompletionResult {
  content: string;
  usage?: TokenUsage;
  toolCalls?: any[];
}

export type CompletionFn = (options: CompletionFnOptions) => Promise<CompletionResult>;

/**
 * Core AIAgent class that orchestrates conversation turns.
 * Handles message history, context compression, and eventually memory/skills.
 */
export class AIAgent {
  private messages: Message[] = [];
  private contextEngine: ContextEngine;
  private config: AgentConfig;

  constructor(config: AgentConfig, contextEngine?: ContextEngine) {
    this.config = config;
    this.contextEngine = contextEngine || new ContextCompressor();
    
    if (config.systemPrompt) {
      this.messages.push({
        role: "system",
        content: config.systemPrompt,
      });
    }
  }

  /**
   * Execute a single turn in the conversation.
   */
  async run(userMessage: string, completionFn: CompletionFn): Promise<string> {
    // 1. Add user message to history
    this.messages.push({
      role: "user",
      content: userMessage,
    });

    // 2. Prefetch context (To be implemented in Phase 2 & 4)
    // - Memory prefetch
    // - Skills matching
    // - Project context loading

    // 3. Make the API call
    const result = await completionFn({
      messages: this.messages,
      model: this.config.model,
      temperature: this.config.temperature,
      topP: this.config.topP,
    });

    // 4. Handle assistant response
    this.messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });

    // 5. Update context engine and check for compression
    if (result.usage) {
      this.contextEngine.updateFromResponse(result.usage);
      if (this.contextEngine.shouldCompress()) {
        this.messages = this.contextEngine.compress(this.messages);
      }
    }

    // 6. Handle tool calls (To be implemented)
    // if (result.toolCalls) { ... }

    return result.content;
  }

  /**
   * Get the current message history.
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Manually add a message to the history.
   */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /**
   * Reset the agent's memory (except system prompt).
   */
  reset(): void {
    const systemPrompt = this.messages.find((m) => m.role === "system");
    this.messages = systemPrompt ? [systemPrompt] : [];
  }
}
