import type { ProviderLoader } from "../loader"

export const MiniMaxProvider: ProviderLoader.Info = {
    async load(input, dep) {
        return {
            autoload: false,
            options: {},
        }
    },
}


