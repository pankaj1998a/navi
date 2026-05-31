import type { ProviderLoader } from "../loader"

export const LmStudioProvider: ProviderLoader.Info = {
    async load(input, dep) {
        return {
            autoload: false,
            options: {},
        }
    },
}


