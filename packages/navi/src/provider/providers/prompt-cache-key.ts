export const PROMPT_CACHE_KEY_PROVIDER_IDS = [
    "abliteration-ai",
    "aihubmix",
    "anyapi",
    "auriko",
    "edenai",
    "jalapeno",
    "llama",
    "morph",
    "snowflake-cortex",
    "tencent-tokenhub",
    "upstage",
    "venice",
] as const

export function supportsPromptCacheKey(providerID: string) {
    return (PROMPT_CACHE_KEY_PROVIDER_IDS as readonly string[]).includes(providerID)
}
