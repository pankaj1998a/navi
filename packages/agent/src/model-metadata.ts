import { Message } from "./types";

/**
 * Model context limits and metadata.
 */
export const MODEL_METADATA: Record<string, { contextWindow: number }> = {
  "claude-3-5-sonnet-20240620": { contextWindow: 200000 },
  "claude-3-sonnet-20240229": { contextWindow: 200000 },
  "claude-3-opus-20240229": { contextWindow: 200000 },
  "claude-3-haiku-20240307": { contextWindow: 200000 },
  "gpt-4o": { contextWindow: 128000 },
  "gpt-4o-mini": { contextWindow: 128000 },
  "gpt-4-turbo": { contextWindow: 128000 },
  "gemini-1.5-pro": { contextWindow: 1000000 },
  "gemini-1.5-flash": { contextWindow: 1000000 },
};

/**
 * Get the context window for a given model.
 */
export function getModelContextLength(model: string): number {
  const metadata = MODEL_METADATA[model];
  return metadata ? metadata.contextWindow : 8192; // Default to 8k
}

/**
 * Roughly estimate the number of tokens in a list of messages.
 * This is a heuristic (approx 4 chars per token).
 */
export function estimateMessagesTokensRough(messages: Message[]): number {
  let totalLength = 0;
  for (const m of messages) {
    totalLength += m.content.length;
    if (m.name) totalLength += m.name.length;
  }
  return Math.ceil(totalLength / 4);
}

export const MINIMUM_CONTEXT_LENGTH = 8000;
