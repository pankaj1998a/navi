import type { ProviderLoader } from "../loader"

export const FireworksProvider: ProviderLoader.Info = {
    async load(input, dep) {
        return {
            autoload: false,
            options: {},
        }
    },
}


