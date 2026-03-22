import { ProviderLoader } from "../loader"

export const MiniMaxProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            options: {},
        }
    },
}
