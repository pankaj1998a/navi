import { ProviderLoader } from "../loader"

export const MoonShotProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            options: {},
        }
    },
}
