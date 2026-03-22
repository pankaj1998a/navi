import { ProviderLoader } from "../loader"

export const LmStudioProvider: ProviderLoader.Info = {
    async load() {
        return {
            autoload: false,
            options: {},
        }
    },
}
