/**
 * browser-engine.ts
 * Shared headless browser engine for all web tools (search, fetch, crawl, scrape).
 * Uses Puppeteer + locally-installed Chrome/Chromium — no external service required.
 */
import * as chromeLauncher from "chrome-launcher"
import puppeteer, { type Browser, type Page } from "puppeteer-core"
import TurndownService from "turndown"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "browser-engine" })

const BROWSER_TIMEOUT = 60_000
const NAVIGATION_TIMEOUT = 30_000
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// ─── Browser singleton ──────────────────────────────────────────────────────

let _browser: Browser | undefined
let _browserRefCount = 0

async function getChromePath(): Promise<string> {
    // 1) Try chrome-launcher first
    try {
        const found = chromeLauncher.Launcher.getFirstInstallation()
        if (found) return found
    } catch {
        // chrome-launcher failed, fall through to manual detection
    }

    // 2) Manual fallback: check common install paths
    const fs = await import("fs")
    const candidates: string[] = []

    if (process.platform === "win32") {
        const prefixes = [
            process.env["PROGRAMFILES"] ?? "C:\\Program Files",
            process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
            process.env["LOCALAPPDATA"] ?? "",
        ].filter(Boolean)

        for (const prefix of prefixes) {
            candidates.push(
                `${prefix}\\Google\\Chrome\\Application\\chrome.exe`,
                `${prefix}\\Microsoft\\Edge\\Application\\msedge.exe`,
                `${prefix}\\Chromium\\Application\\chrome.exe`,
                `${prefix}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
            )
        }
    } else if (process.platform === "darwin") {
        candidates.push(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        )
    } else {
        // Linux
        candidates.push(
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/snap/bin/chromium",
        )
    }

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                log.info("found browser at", { path: candidate })
                return candidate
            }
        } catch {
            // skip invalid path
        }
    }

    throw new Error(
        "Chrome/Chromium not found. Install Google Chrome, Microsoft Edge, or Chromium.\n" +
        "Checked paths:\n" + candidates.slice(0, 6).join("\n"),
    )
}

/** Get or launch a shared headless browser instance. */
export async function getBrowser(opts?: { visible?: boolean }): Promise<Browser> {
    if (_browser && _browser.connected) {
        _browserRefCount++
        return _browser
    }

    const chromePath = await getChromePath()
    const launchOpts = {
        executablePath: chromePath,
        headless: opts?.visible ? false : true,
        defaultViewport: { width: 1280, height: 800 },
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-sync",
        ],
        timeout: BROWSER_TIMEOUT,
    }

    log.info("launching headless browser")
    _browser = await puppeteer.launch(launchOpts)
    _browser.on("disconnected", () => {
        log.warn("browser disconnected")
        _browser = undefined
        _browserRefCount = 0
    })
    _browserRefCount++
    return _browser
}

/** Open a fresh page with a reasonable default config. */
async function openPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage()
    await page.setUserAgent(USER_AGENT)
    await page.setViewport({ width: 1280, height: 800 })

    // Block heavy resources to speed up non-visual fetches
    await page.setRequestInterception(true)
    page.on("request", (req) => {
        const type = req.resourceType()
        if (["image", "media", "font", "stylesheet"].includes(type)) {
            req.abort()
        } else {
            req.continue()
        }
    })

    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT)
    return page
}

// ─── Markdown / text conversion ─────────────────────────────────────────────

const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
})
turndown.remove(["script", "style", "meta", "link", "noscript", "iframe"])

export function htmlToMarkdown(html: string): string {
    try {
        return turndown.turndown(html)
    } catch {
        return html
    }
}

export function htmlToText(html: string): string {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s{2,}/g, " ")
        .trim()
}

// ─── Web Search ─────────────────────────────────────────────────────────────

export interface SearchResult {
    title: string
    url: string
    snippet: string
}

export async function webSearch(query: string, numResults: number = 8): Promise<SearchResult[]> {
    const browser = await getBrowser()
    const page = await openPage(browser)

    try {
        // 1) Try Google
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(numResults, 20)}&hl=en&gl=us`
        await page.goto(googleUrl, { waitUntil: "domcontentloaded" })

        const googleResults: SearchResult[] = await page.evaluate((max) => {
            const results: { title: string; url: string; snippet: string }[] = []
            // Covers multiple Google result layouts
            const selectors = [
                "div.g:not([data-hveid]) a[href]",
                "div[data-sokoban-container] a[href]",
                ".tF2Cxc a[href]",
                ".g a[href]",
            ]

            const seen = new Set<string>()
            for (const sel of selectors) {
                const anchors = document.querySelectorAll(sel)
                for (const a of Array.from(anchors)) {
                    if (results.length >= max) break
                    const anchor = a as HTMLAnchorElement
                    const href = anchor.href
                    if (!href || !href.startsWith("http") || href.includes("google.com/search") || seen.has(href)) continue
                    seen.add(href)

                    const container = anchor.closest("div.g") ?? anchor.closest("[data-sokoban-container]") ?? anchor.parentElement
                    const title = container?.querySelector("h3")?.textContent?.trim() ?? anchor.textContent?.trim() ?? ""
                    const snippet = (container?.querySelector(".VwiC3b, .s3v9rd, span.aCOpRe") as HTMLElement)?.innerText?.trim() ?? ""

                    if (title) results.push({ title, url: href, snippet })
                }
                if (results.length >= max) break
            }
            return results
        }, numResults)

        if (googleResults.length >= 1) return googleResults.slice(0, numResults)

        // 2) Fallback: Bing
        log.info("google returned no results, trying bing")
        await page.goto(
            `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${numResults}&mkt=en-US&setlang=en-US&cc=US`,
            { waitUntil: "domcontentloaded" },
        )

        const bingResults: SearchResult[] = await page.evaluate((max) => {
            const items: { title: string; url: string; snippet: string }[] = []
            for (const li of Array.from(document.querySelectorAll("li.b_algo"))) {
                if (items.length >= max) break
                const a = li.querySelector("h2 a") as HTMLAnchorElement | null
                const snip = li.querySelector(".b_caption p, .b_algoSlug") as HTMLElement | null
                if (a?.href && a.href.startsWith("http")) {
                    items.push({ title: a.textContent?.trim() ?? "", url: a.href, snippet: snip?.innerText?.trim() ?? "" })
                }
            }
            return items
        }, numResults)

        return bingResults.slice(0, numResults)
    } finally {
        await page.close().catch(() => { })
    }
}

// ─── Web Fetch ───────────────────────────────────────────────────────────────

export type FetchFormat = "markdown" | "text" | "html"

export interface FetchResult {
    url: string
    title: string
    content: string
    statusCode: number
}

/**
 * Fetch a page. Tries a fast `fetch()` first; if the page requires JS
 * (detected by thin content), falls back to a full browser render.
 */
export async function webFetch(
    url: string,
    format: FetchFormat = "markdown",
    timeoutMs = 30_000,
    opts?: { preferBrowser?: boolean },
): Promise<FetchResult> {
    if (!opts?.preferBrowser) {
    // ── Fast path: plain HTTP fetch ──
        try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), timeoutMs)
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
            })
            clearTimeout(timer)

            if (response.ok) {
                const html = await response.text()
                // Heuristic: if body text is thin, the page is JS-rendered
                const bodyText = htmlToText(html)
                if (bodyText.length > 200) {
                    return { url, title: extractTitle(html), content: convert(html, format), statusCode: response.status }
                }
            }
        } catch {
            // fall through to browser
        }
    }

    // ── Browser fallback for JS-heavy pages ──
    log.info("falling back to browser fetch", { url })
    const browser = await getBrowser()
    const page = await openPage(browser)
    try {
        const response = await page.goto(url, { waitUntil: "networkidle2" })
        // Wait a bit for late-loading JS
        await new Promise((r) => setTimeout(r, 800))
        const html = await page.content()
        const title = await page.title()
        return {
            url,
            title,
            content: convert(html, format),
            statusCode: response?.status() ?? 200,
        }
    } finally {
        await page.close().catch(() => { })
    }
}

function extractTitle(html: string): string {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    return m ? htmlToText(m[1]) : ""
}

function convert(html: string, format: FetchFormat): string {
    if (format === "html") return html
    if (format === "text") return htmlToText(html)
    return htmlToMarkdown(html)
}

// ─── Web Crawl ───────────────────────────────────────────────────────────────

export interface CrawledPage {
    url: string
    title: string
    content: string
    links: string[]
    depth: number
}

export interface CrawlOptions {
    maxPages?: number
    maxDepth?: number
    sameDomain?: boolean
    format?: FetchFormat
    includePattern?: RegExp
    excludePattern?: RegExp
}

export async function webCrawl(startUrl: string, opts: CrawlOptions = {}): Promise<CrawledPage[]> {
    const {
        maxPages = 10,
        maxDepth = 2,
        sameDomain = true,
        format = "markdown",
        includePattern,
        excludePattern,
    } = opts

    const origin = new URL(startUrl).origin
    const visited = new Set<string>()
    const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }]
    const results: CrawledPage[] = []

    const browser = await getBrowser()

    while (queue.length > 0 && results.length < maxPages) {
        const item = queue.shift()!
        const normalised = item.url.split("#")[0] // strip fragments
        if (visited.has(normalised)) continue
        visited.add(normalised)

        if (item.depth > maxDepth) continue
        if (excludePattern?.test(normalised)) continue
        if (includePattern && !includePattern.test(normalised)) continue

        const page = await openPage(browser)
        try {
            log.info("crawling", { url: normalised, depth: item.depth })
            await page.goto(normalised, { waitUntil: "domcontentloaded" })
            await new Promise((r) => setTimeout(r, 500))

            const html = await page.content()
            const title = await page.title()

            // Extract all links from the page
            const rawLinks: string[] = await page.evaluate(() =>
                Array.from(document.querySelectorAll("a[href]"))
                    .map((a) => (a as HTMLAnchorElement).href)
                    .filter(Boolean),
            )

            const links: string[] = []
            for (const raw of rawLinks) {
                try {
                    const u = new URL(raw)
                    if (sameDomain && u.origin !== origin) continue
                    const normalized = u.href.split("#")[0]
                    if (!visited.has(normalized)) links.push(normalized)
                } catch {
                    // ignore invalid URLs
                }
            }

            results.push({
                url: normalised,
                title,
                content: convert(html, format),
                links: [...new Set(links)].slice(0, 50),
                depth: item.depth,
            })

            // Enqueue follow-on links
            if (item.depth < maxDepth) {
                for (const link of links) {
                    if (!visited.has(link)) {
                        queue.push({ url: link, depth: item.depth + 1 })
                    }
                }
            }
        } catch (err) {
            log.warn("crawl page error", { url: normalised, error: String(err) })
        } finally {
            await page.close().catch(() => { })
        }
    }

    return results
}

// ─── Web Scrape ──────────────────────────────────────────────────────────────

export interface ScrapeField {
    name: string
    selector: string
    attribute?: string // e.g. "href", "src", "data-id" — defaults to innerText
    multiple?: boolean
}

export interface ScrapeResult {
    url: string
    data: Record<string, unknown>
}

/**
 * Extract structured data from a page using CSS selectors.
 * Automatically falls back to a full browser render for JS pages.
 */
export async function webScrape(url: string, fields: ScrapeField[]): Promise<ScrapeResult> {
    const browser = await getBrowser()
    const page = await openPage(browser)

    try {
        await page.goto(url, { waitUntil: "networkidle2" })
        await new Promise((r) => setTimeout(r, 800))

        const data: Record<string, string | string[]> = {}

        for (const field of fields) {
            if (field.multiple) {
                data[field.name] = await page.evaluate(
                    (selector, attr) => {
                        const els = Array.from(document.querySelectorAll(selector))
                        return els.map((el) => {
                            if (attr) return (el as HTMLElement).getAttribute(attr) ?? ""
                            return (el as HTMLElement).innerText?.trim() ?? ""
                        })
                    },
                    field.selector,
                    field.attribute ?? null,
                )
            } else {
                data[field.name] = await page.evaluate(
                    (selector, attr) => {
                        const el = document.querySelector(selector) as HTMLElement | null
                        if (!el) return ""
                        if (attr) return el.getAttribute(attr) ?? ""
                        return el.innerText?.trim() ?? ""
                    },
                    field.selector,
                    field.attribute ?? null,
                )
            }
        }

        return { url, data }
    } finally {
        await page.close().catch(() => { })
    }
}

/** Auto-scrape: extract common page data without needing explicit selectors. */
export async function autoScrape(url: string): Promise<ScrapeResult> {
    const browser = await getBrowser()
    const page = await openPage(browser)

    try {
        await page.goto(url, { waitUntil: "networkidle2" })
        await new Promise((r) => setTimeout(r, 800))

        const data = await page.evaluate(() => {
            const get = (sel: string) => (document.querySelector(sel) as HTMLElement)?.innerText?.trim() ?? ""
            const getAttr = (sel: string, attr: string) => document.querySelector(sel)?.getAttribute(attr) ?? ""
            const getAll = (sel: string) =>
                Array.from(document.querySelectorAll(sel)).map((el) => (el as HTMLElement).innerText?.trim())

            return {
                title: document.title,
                description: getAttr('meta[name="description"]', "content") || getAttr('meta[property="og:description"]', "content"),
                headings: getAll("h1, h2, h3").slice(0, 20),
                paragraphs: getAll("p").filter((t) => t.length > 50).slice(0, 20),
                links: Array.from(document.querySelectorAll("a[href]"))
                    .map((a) => ({ text: (a as HTMLAnchorElement).textContent?.trim(), href: (a as HTMLAnchorElement).href }))
                    .filter((l) => l.href.startsWith("http"))
                    .slice(0, 30),
                images: Array.from(document.querySelectorAll("img[src]"))
                    .map((img) => ({ alt: (img as HTMLImageElement).alt ?? "", src: (img as HTMLImageElement).src }))
                    .slice(0, 20),
                tables: Array.from(document.querySelectorAll("table")).map((table) => {
                    const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
                        Array.from(tr.querySelectorAll("td, th")).map((cell) => (cell as HTMLElement).innerText?.trim()),
                    )
                    return rows
                }),
                mainContent: (document.querySelector("article, main, [role=main], .content, #content") as HTMLElement)?.innerText
                    ?.trim()
                    ?.slice(0, 5000) ?? get("body").slice(0, 5000),
            }
        })

        return { url, data: data as Record<string, unknown> }
    } finally {
        await page.close().catch(() => { })
    }
}


