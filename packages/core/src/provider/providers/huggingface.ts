import { ProviderLoader } from "../loader"

export const HuggingFaceProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            options: {},
        }
    },
}


