// Single-source adapter: the canonical implementation lives in
// provider/sdk/openai-compatible/src/responses/openai-responses-language-model.ts.
// The two copies differed by exactly 1 line (provider-options key "openai" vs
// "copilot"), now parameterized via OpenAIConfig.providerOptionsKey —
// copilot-provider.ts passes "copilot" to preserve behavior.
export { OpenAIResponsesLanguageModel } from "../../openai-compatible/src/responses/openai-responses-language-model"
export type { OpenAIResponsesProviderOptions } from "../../openai-compatible/src/responses/openai-responses-language-model"
