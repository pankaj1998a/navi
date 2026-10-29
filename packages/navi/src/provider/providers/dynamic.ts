import { loadSDKFactory } from "./sdk-factory"

export async function loadDynamicSDK(packageName: string, options: Record<string, any>) {
    const factory = (await loadSDKFactory(packageName)) as (options: Record<string, any>) => unknown
    if (typeof factory !== "function")
        throw new Error(`Package ${packageName} provider factory export is not callable`)
    return factory(options)
}
