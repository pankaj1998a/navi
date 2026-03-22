import { ProviderLoader } from "../loader"

export const FireworksProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            options: {},
        }
    },
}
