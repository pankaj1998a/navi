import type { ProviderLoader } from "../loader"

const PROVIDER_ID = "snowflake-cortex"

function normalizeAccount(value: unknown) {
    if (typeof value !== "string") return ""
    return value
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "")
        .replace(/\.snowflakecomputing\.com$/i, "")
}

function issuer(account: string) {
    return `https://${account}.snowflakecomputing.com`
}

function endpoint(value: unknown, account: string) {
    const baseURL = typeof value === "string" ? value : `${issuer("${SNOWFLAKE_ACCOUNT}")}/api/v2/cortex/v1`
    return account ? baseURL.replaceAll("${SNOWFLAKE_ACCOUNT}", account) : baseURL
}

export const SnowflakeCortexProvider: ProviderLoader.Info = {
    async load(input, dep) {
        const auth = await dep.auth(PROVIDER_ID)
        const apiKey =
            dep.env["SNOWFLAKE_CORTEX_TOKEN"] ??
            dep.env["SNOWFLAKE_CORTEX_PAT"] ??
            (auth?.type === "api" ? auth.key : undefined) ??
            dep.config.provider?.[PROVIDER_ID]?.options?.apiKey
        const account = normalizeAccount(
            dep.env["SNOWFLAKE_ACCOUNT"] ?? (auth?.type === "api" ? auth.metadata?.account : undefined),
        )

        const hasKey = !!apiKey
        return {
            autoload: hasKey,
            options: hasKey
                ? {
                      apiKey,
                      baseURL: endpoint(
                          input?.options?.baseURL ?? dep.config.provider?.[PROVIDER_ID]?.options?.baseURL,
                          account,
                      ),
                  }
                : {},
            models: hasKey ? undefined : {},
        }
    },
}
