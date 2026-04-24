import { ProviderLoader } from "../loader"

export const BasetenProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            options: {},
        }
    },
}


