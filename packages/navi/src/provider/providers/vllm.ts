import { createLocalProvider } from "./local"

const PROVIDER_ID = "vllm"

interface VllmModel {
    id: string
    owned_by: string
    max_model_len: number | null
}

export const VllmProvider = createLocalProvider<VllmModel>({
    providerID: PROVIDER_ID,
    origin: "http://127.0.0.1:8000",
    discover: async (baseURL, apiKey) => {
        const headers: Record<string, string> = { Accept: "application/json" }
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
        const root = baseURL.replace(/\/v1$/, "")
        const health = await fetch(`${root}/health`, { headers, signal: AbortSignal.timeout(1000) })
        if (!health.ok) throw new Error(`vLLM health check failed: ${health.status}`)
        const res = await fetch(`${baseURL}/models`, { headers, signal: AbortSignal.timeout(1000) })
        if (!res.ok) throw new Error(`vLLM models request failed: ${res.status}`)
        const data = (await res.json()) as { data?: VllmModel[] }
        return (data.data ?? [])
            .filter((m) => m.owned_by === PROVIDER_ID && m.id.length > 0)
            .sort((a, b) => a.id.localeCompare(b.id))
    },
    model: (item) => ({
        id: item.id,
        context: item.max_model_len,
    }),
})
