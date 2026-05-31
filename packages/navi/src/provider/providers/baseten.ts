import type { ProviderLoader } from "../loader"

export const BasetenProvider: ProviderLoader.Info = {
    async load(input, dep) {
        return {
            autoload: false,
            options: {},
        }
    },
}


