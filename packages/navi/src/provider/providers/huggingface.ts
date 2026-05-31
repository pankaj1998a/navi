import type { ProviderLoader } from "../loader"

export const HuggingFaceProvider: ProviderLoader.Info = {
    async load(input, dep) {
        return {
            autoload: false,
            options: {},
        }
    },
}


