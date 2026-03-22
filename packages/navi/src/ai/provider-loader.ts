
export class ProviderLoader {
    private loadedProviders: Map<string, any> = new Map()

    async loadProvider(providerId: string): Promise<any> {
        if (this.loadedProviders.has(providerId)) {
            return this.loadedProviders.get(providerId)
        }

        let providerModule
        try {
            switch (providerId) {
                case 'anthropic':
                    providerModule = await import('@ai-sdk/anthropic')
                    break
                case 'openai':
                    providerModule = await import('@ai-sdk/openai')
                    break
                case 'google':
                    providerModule = await import('@ai-sdk/google')
                    break
                case 'amazon-bedrock':
                    providerModule = await import('@ai-sdk/amazon-bedrock')
                    break
                case 'azure':
                    providerModule = await import('@ai-sdk/azure')
                    break
                case 'cerebras':
                    providerModule = await import('@ai-sdk/cerebras')
                    break
                case 'cohere':
                    providerModule = await import('@ai-sdk/cohere')
                    break
                case 'deepinfra':
                    providerModule = await import('@ai-sdk/deepinfra')
                    break
                case 'google-vertex':
                    providerModule = await import('@ai-sdk/google-vertex')
                    break
                case 'groq':
                    providerModule = await import('@ai-sdk/groq')
                    break
                case 'mistral':
                    providerModule = await import('@ai-sdk/mistral')
                    break
                case 'openai-compatible':
                    providerModule = await import('@ai-sdk/openai-compatible')
                    break
                case 'perplexity':
                    providerModule = await import('@ai-sdk/perplexity')
                    break
                case 'togetherai':
                    providerModule = await import('@ai-sdk/togetherai')
                    break
                case 'vercel':
                    providerModule = await import('@ai-sdk/vercel')
                    break
                case 'xai':
                    providerModule = await import('@ai-sdk/xai')
                    break
                default:
                    throw new Error(`Unknown provider: ${providerId}`)
            }
        } catch (e) {
            throw new Error(`Failed to load provider ${providerId}: ${e}`)
        }

        this.loadedProviders.set(providerId, providerModule)
        return providerModule
    }
}

export const providerLoader = new ProviderLoader()
