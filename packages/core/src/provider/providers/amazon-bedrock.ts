import { ProviderLoader } from "../loader"
import { Config } from "../../config/config"
import { Auth } from "../../auth"
import { Env } from "../../env"
import { iife } from "../../util/iife"
import { BunProc } from "../../bun"
import type { AmazonBedrockProviderSettings } from "@ai-sdk/amazon-bedrock"

export const AmazonBedrockProvider: ProviderLoader.Info = {
    async load() {
        const config = await Config.get()
        const providerConfig = config.provider?.["amazon-bedrock"]

        const auth = await Auth.get("amazon-bedrock")

        // Region precedence: 1) config file, 2) env var, 3) default
        const configRegion = providerConfig?.options?.region
        const envRegion = Env.get("AWS_REGION")
        const defaultRegion = configRegion ?? envRegion ?? "us-east-1"

        // Profile: config file takes precedence over env var
        const configProfile = providerConfig?.options?.profile
        const envProfile = Env.get("AWS_PROFILE")
        const profile = configProfile ?? envProfile

        const awsAccessKeyId = Env.get("AWS_ACCESS_KEY_ID")

        const awsBearerToken = iife(() => {
            const envToken = Env.get("AWS_BEARER_TOKEN_BEDROCK")
            if (envToken) return envToken
            if (auth?.type === "api") {
                Env.set("AWS_BEARER_TOKEN_BEDROCK", auth.key)
                return auth.key
            }
            return undefined
        })

        if (!profile && !awsAccessKeyId && !awsBearerToken) return { autoload: false, models: {} }

        const { fromNodeProviderChain } = await import(await BunProc.install("@aws-sdk/credential-providers"))

        // Build credential provider options (only pass profile if specified)
        const credentialProviderOptions = profile ? { profile } : {}

        const providerOptions: AmazonBedrockProviderSettings = {
            region: defaultRegion,
            credentialProvider: fromNodeProviderChain(credentialProviderOptions),
        }

        // Add custom endpoint if specified (endpoint takes precedence over baseURL)
        const endpoint = providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL
        if (endpoint) {
            providerOptions.baseURL = endpoint
        }

        return {
            autoload: true,
            options: providerOptions,
            async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
                // Skip region prefixing if model already has a cross-region inference profile prefix
                if (
                    modelID.startsWith("global.") ||
                    modelID.startsWith("us.") ||
                    modelID.startsWith("eu.") ||
                    modelID.startsWith("jp.") ||
                    modelID.startsWith("apac.") ||
                    modelID.startsWith("au.")
                ) {
                    return sdk.languageModel(modelID)
                }

                // Region resolution precedence (highest to lowest):
                // 1. options.region from navi.json provider config
                // 2. defaultRegion from AWS_REGION environment variable
                // 3. Default "us-east-1" (baked into defaultRegion)
                const region = options?.region ?? defaultRegion

                let regionPrefix = region.split("-")[0]

                switch (regionPrefix) {
                    case "us": {
                        const modelRequiresPrefix = [
                            "nova-micro",
                            "nova-lite",
                            "nova-pro",
                            "nova-premier",
                            "nova-2",
                            "claude",
                            "deepseek",
                        ].some((m) => modelID.includes(m))
                        const isGovCloud = region.startsWith("us-gov")
                        if (modelRequiresPrefix && !isGovCloud) {
                            modelID = `${regionPrefix}.${modelID}`
                        }
                        break
                    }
                    case "eu": {
                        const regionRequiresPrefix = [
                            "eu-west-1",
                            "eu-west-2",
                            "eu-west-3",
                            "eu-north-1",
                            "eu-central-1",
                            "eu-south-1",
                            "eu-south-2",
                        ].some((r) => region.includes(r))
                        const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((m) =>
                            modelID.includes(m),
                        )
                        if (regionRequiresPrefix && modelRequiresPrefix) {
                            modelID = `${regionPrefix}.${modelID}`
                        }
                        break
                    }
                    case "ap": {
                        const isAustraliaRegion = ["ap-southeast-2", "ap-southeast-4"].includes(region)
                        const isTokyoRegion = region === "ap-northeast-1"
                        if (
                            isAustraliaRegion &&
                            ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((m) => modelID.includes(m))
                        ) {
                            regionPrefix = "au"
                            modelID = `${regionPrefix}.${modelID}`
                        } else if (isTokyoRegion) {
                            // Tokyo region uses jp. prefix for cross-region inference
                            const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                                modelID.includes(m),
                            )
                            if (modelRequiresPrefix) {
                                regionPrefix = "jp"
                                modelID = `${regionPrefix}.${modelID}`
                            }
                        } else {
                            // Other APAC regions use apac. prefix
                            const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                                modelID.includes(m),
                            )
                            if (modelRequiresPrefix) {
                                regionPrefix = "apac"
                                modelID = `${regionPrefix}.${modelID}`
                            }
                        }
                        break
                    }
                }

                return sdk.languageModel(modelID)
            },
        }
    },
}


