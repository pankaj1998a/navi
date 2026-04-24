import { ProviderLoader } from "../loader"

export const AnthropicProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            options: {
                headers: {
                    "anthropic-beta":
                        "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,prompt-caching-2024-07-31",
                },
            },
        }
    },
}


