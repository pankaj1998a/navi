import { z } from "zod";

export const MessageRole = z.enum(["system", "user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof MessageRole>;

export const Message = z.object({
  role: MessageRole,
  content: z.string(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
});
export type Message = z.infer<typeof Message>;

export const TokenUsage = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export interface ModelConfig {
  modelID: string;
  providerID: string;
}

export interface AgentConfig {
  name: string;
  systemPrompt?: string;
  model: ModelConfig;
  temperature?: number;
  topP?: number;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: any;
}

export interface Route {
  model: ModelConfig;
  reason: string;
}
