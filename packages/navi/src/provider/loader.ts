import { Provider } from "./provider"
import { Auth } from "../auth"
import { Config } from "../config/config"

export namespace ProviderLoader {
    export interface Result {
        autoload: boolean
        getModel?: (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
        options?: Record<string, any>
        models?: Record<string, Provider.Model>
    }

    export interface Info {
        load(provider: Provider.Info, dep: {
            auth(id: string): Promise<Auth.Info | undefined>
            config: Config.Info
            env: Record<string, string | undefined>
        }): Promise<Result>
    }
}


