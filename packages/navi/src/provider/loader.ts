import { Provider } from "./provider"

export namespace ProviderLoader {
    export interface Result {
        autoload: boolean
        getModel?: (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
        options?: Record<string, any>
        models?: Record<string, Provider.Model>
    }

    export interface Info {
        load(provider: Provider.Info): Promise<Result>
    }
}
