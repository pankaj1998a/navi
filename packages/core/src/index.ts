// @navi-ai/core main library entry point

// 1. Re-export all sub-packages
export * from './agents/index.ts';
export * from './availability/index.ts';
export * from './bus/index.ts';
export * from './core/index.ts';
export * from './hooks/index.ts';
export * from './services/index.ts';
export * from './tools/index.ts';
export * from './util/index.ts';
export * from './confirmation-bus/index.ts';
export * from './effect/index.ts';
export * from './flag/index.ts';
export * from './project/index.ts';
export * from './snapshot/index.ts';
export * from './storage/index.ts';
export * from './sync/index.ts';
export * from './permission/index.ts';
export * from './session/index.ts';
export * from './provider/index.ts';
export * from './id/index.ts';
export * from './auth/index.ts';
export * from './plugin/index.ts';
export * from './question/index.ts';
export * from './command/index.ts';
export * from './share/index.ts';
export * from './scheduler/index.ts';
export * from './shell/index.ts';
export * from './tool/index.ts';
export * from './lsp/index.ts';
export * from './installation/index.ts';

// 2. Resolve conflicting exports from config/
export { 
  Config,
  type AgentRunConfig as ConfigAgentRunConfig,
  MCPServerConfig
} from './config/config.ts';

export {
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  DEFAULT_URL_FETCH_TIMEOUT_MS,
  DEFAULT_MAX_CONTENT_LENGTH
} from './config/config.ts';

// Re-export constants while avoiding ambiguity
export * from './config/constants.ts';
export * from './config/defaultModelConfigs.ts';
export * from './config/models.ts';
// We don't export * from storage.ts to avoid GOOGLE_ACCOUNTS_FILENAME conflict
// But we might need other things from it.
export { Storage } from './config/storage.ts';

// 3. Global constants
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
export const DEFAULT_GEMINI_VARIANT = 'default';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'text-embedding-004';
