/**
 * http-search.ts
 * Pure HTTP-based web search — no browser required.
 * Tries Google → Bing → DuckDuckGo in order, returning the first
 * provider that gives results.
 */
import { Log } from "../util/log"
import type { SearchExecution, SearchProvider, SearchResult } from "./search-pipeline"

const log = Log.create({ service: "http-search" })

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripTags(html: string): string {
    return html
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, "/")
        .replace(/&nbsp;/g, " ")
        .replace(/&#\d+;/g, "")      // strip remaining numeric entities
        .replace(/&#x[0-9a-f]+;/gi, "") // strip remaining hex entities
        .replace(/\s{2,}/g, " ")
        .trim()
}

async function httpGet(url: string, timeoutMs = 12_000): Promise<string | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                "Cache-Control": "no-cache",
            },
        })
        clearTimeout(timer)
        if (!res.ok) return null
        return await res.text()
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

// ─── Google ──────────────────────────────────────────────────────────────────

async function searchGoogle(query: string, num: number): Promise<SearchResult[]> {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(num + 3, 20)}&hl=en&gl=us`
    const html = await httpGet(url)
    if (!html) return []

    const results: SearchResult[] = []
    const seen = new Set<string>()

    // Google wraps each result in <div class="g"> or <div data-hveid>
    // The <a> with href that points outside google has the URL
    // Title is in <h3>
    // Snippet is in class="VwiC3b" or similar

    // Extract all anchor href + h3 combos
    // Pattern: find <a href="https://..."> that is NOT a google internal link
    const anchorRe = /<a\s+[^>]*href="(https?:\/\/(?!(?:www\.)?google\.[a-z]+\/)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    const h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>/i
    const snippetRe = /class="(?:VwiC3b|yXK7lf|MUxGbd|s3v9rd)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i

    // Split by <div class="g" or data-sokoban
    const sections = html.split(/<div\s+[^>]*(?:class="(?:[^"]*\bg\b)[^"]*"|data-sokoban-container)[^>]*>/i)

    for (const section of sections) {
        if (results.length >= num) break

        let match: RegExpExecArray | null
        const re = new RegExp(anchorRe.source, "gi")
        while ((match = re.exec(section)) !== null) {
            const href = match[1]
            if (seen.has(href)) continue
            // Skip google internal, ads, etc.
            if (href.includes("google.com") || href.includes("googleadservices") || href.includes("#")) continue

            seen.add(href)

            const titleMatch = h3Re.exec(section)
            const snippetMatch = snippetRe.exec(section)

            const title = titleMatch ? stripTags(titleMatch[1]) : stripTags(match[2])
            const snippet = snippetMatch ? stripTags(snippetMatch[1]) : ""

            if (title) {
                results.push({ title, url: href, snippet })
                break
            }
        }
    }

    // Fallback: simpler scan of the whole page
    if (results.length === 0) {
        const allLinks = /<a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*><h3[^>]*>([\s\S]*?)<\/h3>/gi
        let m: RegExpExecArray | null
        while ((m = allLinks.exec(html)) !== null && results.length < num) {
            const href = m[1]
            const title = stripTags(m[2])
            if (!href.includes("google.com") && !seen.has(href) && title) {
                seen.add(href)
                results.push({ title, url: href, snippet: "" })
            }
        }
    }

    return results
}

// ─── Bing ────────────────────────────────────────────────────────────────────

async function searchBing(query: string, num: number): Promise<SearchResult[]> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(num + 3, 20)}&setlang=en-US&mkt=en-US&cc=US`
    const html = await httpGet(url)
    if (!html) return []

    const results: SearchResult[] = []
    const seen = new Set<string>()

    // Bing results are in <li class="b_algo">
    const blocks = html.split(/<li\s+class="b_algo"/)
    for (let i = 1; i < blocks.length && results.length < num; i++) {
        const block = blocks[i]

        // Title + URL: <h2><a href="...">title</a></h2>
        const titleUrlMatch = block.match(/<h2[^>]*><a\s+[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/)
        // Snippet: <p class="b_algoSlug"> or <p class="b_lineclamp...">
        const snippetMatch = block.match(/<p\s+[^>]*(?:class="b_algoSlug|class="b_lineclamp)[^>]*>([\s\S]*?)<\/p>/)

        if (titleUrlMatch) {
            const href = titleUrlMatch[1]
            const title = stripTags(titleUrlMatch[2])
            if (!seen.has(href) && title && !href.includes("bing.com")) {
                seen.add(href)
                results.push({
                    title,
                    url: href,
                    snippet: snippetMatch ? stripTags(snippetMatch[1]) : "",
                })
            }
        }
    }

    return results
}

// ─── DuckDuckGo ──────────────────────────────────────────────────────────────

async function searchDuckDuckGo(query: string, num: number): Promise<SearchResult[]> {
    // kl=wt-wt = worldwide / no region (English), kp=-2 = safe off, df= no date filter
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt&kp=-2`
    const html = await httpGet(url)
    if (!html) return []

    const results: SearchResult[] = []
    const seen = new Set<string>()

    // DDG wraps results in <div class="result results_links...">
    // Title: <a class="result__a" href="//duckduckgo.com/l/?uddg=ENCODED_URL">title</a>
    // Snippet: <a class="result__snippet">...</a>

    const titleRe = /<a\s+[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    const snippetRe = /<a\s+[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i

    // Split by result divs
    const blocks = html.split(/<div\s+[^>]*class="result\s/)
    for (let i = 1; i < blocks.length && results.length < num; i++) {
        const block = blocks[i]

        const re = new RegExp(titleRe.source, "gi")
        const m = re.exec(block)
        if (!m) continue

        let href = m[1]
        // DDG encodes the real URL in the uddg param
        const uddgMatch = href.match(/uddg=([^&]+)/)
        if (uddgMatch) {
            try { href = decodeURIComponent(uddgMatch[1]) } catch { continue }
        }

        if (!href.startsWith("http") || seen.has(href)) continue
        seen.add(href)

        const title = stripTags(m[2])
        const snippetM = snippetRe.exec(block)
        const snippet = snippetM ? stripTags(snippetM[1]) : ""

        if (title) results.push({ title, url: href, snippet })
    }

    return results
}

// ─── Tavily ──────────────────────────────────────────────────────────────────

async function searchTavily(query: string, num: number): Promise<SearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) return []

    try {
        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                search_depth: "advanced",
                max_results: num,
            }),
        })

        if (!response.ok) return []
        const data = await response.json()
        return (data.results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
        }))
    } catch (e) {
        log.warn("Tavily search failed", { error: String(e) })
        return []
    }
}

// ─── Firecrawl ───────────────────────────────────────────────────────────────

async function searchFirecrawl(query: string, num: number): Promise<SearchResult[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) return []

    try {
        const response = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query,
                limit: num,
                scrapeOptions: { formats: ["markdown"] },
            }),
        })

        if (!response.ok) return []
        const data = await response.json()
        return (data.data || []).map((r: any) => ({
            title: r.title || r.metadata?.title || "",
            url: r.url || r.metadata?.sourceURL || "",
            snippet: r.markdown || r.content || "",
        }))
    } catch (e) {
        log.warn("Firecrawl search failed", { error: String(e) })
        return []
    }
}

// ─── Exa ─────────────────────────────────────────────────────────────────────

async function searchExa(query: string, num: number): Promise<SearchResult[]> {
    const apiKey = process.env.EXA_API_KEY

    // Try API first if key is available
    if (apiKey) {
        try {
            const body = {
                query,
                numResults: num,
                type: "auto",
                contents: { highlights: true, summary: true },
            }
            const response = await fetch("https://api.exa.ai/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                },
                body: JSON.stringify(body),
            })

            if (response.ok) {
                const data = await response.json()
                return (data.results || []).map((r: any) => ({
                    title: r.title || r.url || "",
                    url: r.url || "",
                    snippet: `${r.summary || ""} ${r.highlights?.join(" \n") || ""}`.trim() || r.text || "",
                }))
            }
        } catch (e) {
            log.warn("Exa API search failed", { error: String(e) })
        }
    }

    // Fallback to MCP endpoint (like Navi) if API fails or no key
    try {
        const response = await fetch("https://mcp.exa.ai/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: {
                    name: "web_search_exa",
                    arguments: { query, numResults: num },
                },
            }),
        })

        if (!response.ok) return []
        const responseText = await response.text()
        
        // Exa MCP returns SSE-like data even on a single POST it seems, or just stringified JSON
        // Based on internal logic, we parse "data: " lines
        const lines = responseText.split("\n")
        for (const line of lines) {
            if (line.startsWith("data: ")) {
                try {
                    const data = JSON.parse(line.substring(6))
                    if (data.result?.content?.[0]?.text) {
                        return [{
                            title: `Exa search: ${query}`,
                            url: "https://exa.ai",
                            snippet: data.result.content[0].text
                        }]
                    }
                } catch { continue }
            }
        }
        
        // If not SSE, try direct JSON
        try {
            const data = JSON.parse(responseText)
            if (data.result?.content?.[0]?.text) {
                return [{
                    title: `Exa search: ${query}`,
                    url: "https://exa.ai",
                    snippet: data.result.content[0].text
                }]
            }
        } catch { /* ignore */ }

    } catch (e) {
        log.warn("Exa MCP fallback failed", { error: String(e) })
    }

    return []
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function searchWithProvider(provider: Exclude<SearchProvider, "browser" | "google-api">, query: string, numResults = 8): Promise<SearchResult[]> {
    if (provider === "google") {
        const googleResults = await searchGoogle(query, numResults)
        if (googleResults.length >= 1) {
            log.info(`google returned ${googleResults.length} results`)
        }
        return googleResults.slice(0, numResults)
    }

    if (provider === "bing") {
        const bingResults = await searchBing(query, numResults)
        if (bingResults.length >= 1) {
            log.info(`bing returned ${bingResults.length} results`)
        }
        return bingResults.slice(0, numResults)
    }

    if (provider === "tavily") {
        const results = await searchTavily(query, numResults)
        if (results.length > 0) log.info(`tavily returned ${results.length} results`)
        return results
    }

    if (provider === "firecrawl") {
        const results = await searchFirecrawl(query, numResults)
        if (results.length > 0) log.info(`firecrawl returned ${results.length} results`)
        return results
    }

    if (provider === "exa") {
        const results = await searchExa(query, numResults)
        if (results.length > 0) log.info(`exa returned ${results.length} results`)
        return results
    }

    if (provider === "brave") {
        const results = await searchBrave(query, numResults)
        if (results.length > 0) log.info(`brave returned ${results.length} results`)
        return results
    }

    if (provider === "searxng") {
        const results = await searchSearXNG(query, numResults)
        if (results.length > 0) log.info(`searxng returned ${results.length} results`)
        return results
    }

    const ddgResults = await searchDuckDuckGo(query, numResults)
    if (ddgResults.length >= 1) {
        log.info(`duckduckgo returned ${ddgResults.length} results`)
    }
    return ddgResults.slice(0, numResults)
}

/**
 * Search the web via HTTP only (no browser needed).
 * Tries Google → Bing → DuckDuckGo in order.
 */
export async function httpSearchDetailed(query: string, numResults = 8): Promise<SearchExecution> {
    const attemptedProviders: SearchProvider[] = []

    for (const provider of ["tavily", "exa", "brave", "firecrawl", "google", "bing", "duckduckgo", "searxng"] as const) {
        attemptedProviders.push(provider)
        try {
            const results = await searchWithProvider(provider, query, numResults)
            if (results.length > 0) {
                return { provider, attemptedProviders, results }
            }
        } catch (e) {
            log.warn(`${provider} search failed`, { error: String(e) })
        }
    }

    return { provider: "none", attemptedProviders, results: [] }
}

// ─── Brave ──────────────────────────────────────────────────────────────────

async function searchBrave(query: string, num: number): Promise<SearchResult[]> {
    const apiKey = process.env.BRAVE_API_KEY
    if (!apiKey) return []

    try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search")
        url.searchParams.set("q", query)
        url.searchParams.set("count", String(num))

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Accept: "application/json",
                "X-Subscription-Token": apiKey,
            },
        })

        if (!response.ok) return []
        const data: any = await response.json()
        const results = data.web?.results || []
        return results.map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.description,
        }))
    } catch (e) {
        log.warn("Brave search failed", { error: String(e) })
        return []
    }
}

// ─── SearXNG ────────────────────────────────────────────────────────────────

async function searchSearXNG(query: string, num: number): Promise<SearchResult[]> {
    const baseUrl = process.env.SEARXNG_URL
    if (!baseUrl) return []

    try {
        const url = new URL("/search", baseUrl)
        url.searchParams.set("q", query)
        url.searchParams.set("format", "json")
        url.searchParams.set("number_of_results", String(num))

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
        })

        if (!response.ok) return []
        const data: any = await response.json()
        return (data.results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.content || r.snippet,
        }))
    } catch (e) {
        log.warn("SearXNG search failed", { error: String(e) })
        return []
    }
}

export async function httpSearch(query: string, numResults = 8): Promise<SearchResult[]> {
    const result = await httpSearchDetailed(query, numResults)
    return result.results
}


