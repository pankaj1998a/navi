import type { ProviderLoader } from "../loader"

export function createProviderPlugin(input: {
    id: string
    npm: string
    load: (options: Record<string, any>) => Promise<unknown>
}): ProviderLoader.Info {
    return {
        async load(_provider, dep) {
            const configured = dep.config.provider?.[input.id]?.options ?? {}
            return {
                autoload: false,
                options: { ...configured },
                async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
                    if (sdk?.languageModel) return sdk.languageModel(modelID)
                    const created = (await input.load({ ...configured, ...options })) as any
                    if (typeof created?.languageModel === "function") return created.languageModel(modelID)
                    if (typeof created === "function") return created(modelID)
                    return created
                },
            }
        },
    }
}
