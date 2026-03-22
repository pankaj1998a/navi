import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./google-search.txt"
import { executeSearchPipeline, normalizeSearchQuery, type SearchResult } from "./search-pipeline"

/**
 * Google AI Search Tool
 * Uses the same HTTP search pipeline as websearch (Google → Bing → DuckDuckGo)
 * with a focus on providing comprehensive, summarized results.
 */
export const GoogleSearchTool = Tool.define("googlesearch", {
    description: DESCRIPTION,
    parameters: z.object({
        query: z.string().describe("Search query"),
        numResults: z.number().optional().describe("Maximum number of search results to include (default: 8)"),
    }),
    async execute(params, ctx) {
        const query = normalizeSearchQuery(params.query)
        const numResults = Math.min(Math.max(params.numResults ?? 8, 1), 15)

        await ctx.ask({
            permission: "websearch",
            patterns: [query],
            always: ["*"],
            metadata: { query, provider: "google-ai" },
        })

        const { CacheManager } = await import("../config/cache-config")
        const cache = CacheManager.getInstance().getCache("webSearch")
        const cacheKey = `google-ai:${query}`
        const cached = cache.get(cacheKey)
        if (cached) return cached

        // Try custom Google Search API if configured
        const googleApiUrl = process.env.GOOGLE_AI_SEARCH_URL ?? process.env.GOOGLE_SEARCH_URL
        if (googleApiUrl) {
            try {
                const response = await fetch(googleApiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query, numResults }),
                    signal: ctx.abort,
                })
                if (response.ok) {
                    const data = await response.json()
                    const result = {
                        output: data.summary || data.output || JSON.stringify(data),
                        title: `Google AI Search: ${params.query}`,
                        metadata: { source: "google-api", provider: "google-api", normalizedQuery: query },
                    }
                    cache.set(cacheKey, result)
                    return result
                }
            } catch { }
        }

        const search = await executeSearchPipeline(query, numResults, ["google", "browser", "bing", "duckduckgo"])
        const searchResults = search.results

        if (searchResults.length === 0) {
            return {
                output: `No results found for: "${params.query}"`,
                title: `Google AI Search: ${params.query}`,
                metadata: { provider: "none", attemptedProviders: search.attemptedProviders, normalizedQuery: query },
            }
        }

        const aiSummary = await summarizeWithGoogleAi(query, searchResults, ctx.abort)

        const lines: string[] = [
            `Google-style search results for: "${params.query}"`,
            `Search provider: ${search.provider}`,
            `AI synthesis: ${aiSummary.mode}`,
            "",
            "Summary:",
            aiSummary.summary,
            "",
            "Results:",
            "",
        ]
        searchResults.forEach((r, i) => {
            lines.push(`${i + 1}. **${r.title}**`)
            lines.push(`   URL: ${r.url}`)
            if (r.snippet) lines.push(`   ${r.snippet}`)
            lines.push("")
        })

        const result = {
            output: lines.join("\n"),
            title: `Google AI Search: ${params.query}`,
            metadata: {
                provider: search.provider,
                attemptedProviders: search.attemptedProviders,
                aiMode: aiSummary.mode,
                numResults: searchResults.length,
                normalizedQuery: query,
            },
        }
        cache.set(cacheKey, result)
        return result
    },
})

async function summarizeWithGoogleAi(
    query: string,
    results: SearchResult[],
    abort: AbortSignal,
): Promise<{ mode: "gemini" | "heuristic"; summary: string }> {
    try {
        const { getAccessToken, geminiCliFetch, resolveGeminiModelID } = await import("../provider/gemini-cli")
        const token = await getAccessToken()
        if (!token) {
            return { mode: "heuristic", summary: summarizeResults(results) }
        }

        const model = resolveGeminiModelID(process.env.NAVI_GOOGLE_AI_MODEL ?? "gemini-2.5-flash")
        const prompt = buildGoogleAiPrompt(query, results)
        const response = await geminiCliFetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
                method: "POST",
                signal: abort,
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: prompt }],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 900,
                    },
                }),
            },
        )

        if (!response.ok) {
            return { mode: "heuristic", summary: summarizeResults(results) }
        }

        const data = await response.json()
        const text = extractGeminiText(data)
        if (!text) {
            return { mode: "heuristic", summary: summarizeResults(results) }
        }

        return { mode: "gemini", summary: text.trim() }
    } catch {
        return { mode: "heuristic", summary: summarizeResults(results) }
    }
}

function buildGoogleAiPrompt(query: string, results: SearchResult[]): string {
    const sources = results
        .map((result, index) => {
            const snippet = result.snippet?.trim() ? `Snippet: ${result.snippet.trim()}` : "Snippet: none"
            return `[${index + 1}] ${result.title}\nURL: ${result.url}\n${snippet}`
        })
        .join("\n\n")

    return [
        "You are Google AI Search inside Navi.",
        "Synthesize the search results into a concise factual overview.",
        "Requirements:",
        "- Use only the supplied search results.",
        "- Keep it under 8 bullets or short paragraphs.",
        "- Cite sources inline like [1], [2].",
        "- Call out disagreement or uncertainty explicitly.",
        `Query: ${query}`,
        "",
        "Search results:",
        sources,
    ].join("\n")
}

function extractGeminiText(data: any): string {
    const candidate = data?.candidates?.[0]
    const parts = candidate?.content?.parts
    if (!Array.isArray(parts)) return ""
    return parts
        .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
}

function summarizeResults(results: SearchResult[]): string {
    const bullets = results
        .slice(0, 5)
        .map((result, index) => {
            const detail = result.snippet?.trim() ? `: ${result.snippet.trim()}` : ""
            return `${index + 1}. ${result.title}${detail} [${index + 1}]`
        })

    return bullets.join("\n")
}
