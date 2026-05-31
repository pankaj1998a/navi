import type { ProviderLoader } from "../loader"

export const MoonShotProvider: ProviderLoader.Info = {
    async load(input, dep) {
        return {
            autoload: false,
            options: {},
        }
    },
}


