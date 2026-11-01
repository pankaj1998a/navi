import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { WithInstance } from "../../src/project/with-instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { BrowserTool } from "../../src/tool/browser"
import { webFetch } from "../../src/tool/browser-engine"
import { CodeSearchTool } from "../../src/tool/codesearch"
import { DuckDuckGoSearchTool } from "../../src/tool/duckduckgo-search"
import { searchWithProvider } from "../../src/tool/http-search"
import { WebCrawlTool } from "../../src/tool/webcrawl"
import { WebScrapeTool } from "../../src/tool/webscrape"

// These tests never reach a real socket or a real browser: every case either
// fails inside the egress guard before the request, or is served by a stubbed
// `fetch`. Denied URLs are rejected before the SSRF probe runs, so the real
// SSRF guard stays in place (its behaviour is covered by util/ssrf tests).

const projectRoot = path.join(import.meta.dir, "../..")

const ctx = {
  sessionID: SessionID.make("ses_network_policy"),
  messageID: MessageID.make("msg_network_policy"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const layer = Layer.mergeAll(FetchHttpClient.layer, Truncate.defaultLayer, Agent.defaultLayer)

function exec(tool: any, args: unknown) {
  return tool.pipe(
    Effect.flatMap((info: any) => info.init()),
    Effect.flatMap((def: any) => def.execute(args, ctx)),
    Effect.provide(layer),
    Effect.runPromise,
  )
}

interface FetchCall {
  url: string
  init?: RequestInit
}

const realFetch = globalThis.fetch

type Handler = (url: string, init?: RequestInit) => Response | undefined

/**
 * Install a `fetch` stub for the duration of one test. Only the URLs the
 * handler claims are intercepted; everything else is delegated to the real
 * implementation so load-time captures elsewhere keep working.
 */
function installFetch(handler: Handler) {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input?.url ?? input)
    calls.push({ url, init })
    return handler(url, init) ?? realFetch(input, init)
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch
    },
  }
}

/** Calls recorded for a given host, ignoring unrelated pass-through traffic. */
function callsFor(calls: FetchCall[], host: string) {
  return calls.filter((call) => call.url.includes(host))
}

const saved = {
  allow: process.env.NAVI_NETWORK_ALLOW,
  deny: process.env.NAVI_NETWORK_DENY,
}

beforeEach(() => {
  delete process.env.NAVI_NETWORK_ALLOW
  delete process.env.NAVI_NETWORK_DENY
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (saved.allow === undefined) delete process.env.NAVI_NETWORK_ALLOW
  else process.env.NAVI_NETWORK_ALLOW = saved.allow
  if (saved.deny === undefined) delete process.env.NAVI_NETWORK_DENY
  else process.env.NAVI_NETWORK_DENY = saved.deny
})

const LONG_HTML = `<html><head><title>ok</title></head><body><p>${"lorem ipsum dolor sit amet ".repeat(
  20,
)}</p></body></html>`

describe("tool network policy enforcement", () => {
  describe("webscrape / webcrawl", () => {
    test("webscrape rejects a denied host before any fetch or browser launch", async () => {
      process.env.NAVI_NETWORK_DENY = "blocked.test"
      const f = installFetch(() => undefined)
      try {
        await expect(exec(WebScrapeTool, { url: "https://blocked.test/page", mode: "auto" })).rejects.toThrow(
          /NETWORK_BLOCKED/,
        )
        expect(callsFor(f.calls, "blocked.test").length).toBe(0)
      } finally {
        f.restore()
      }
    })

    test("webscrape rejects non-http schemes", async () => {
      const f = installFetch(() => undefined)
      try {
        await expect(exec(WebScrapeTool, { url: "file:///etc/passwd", mode: "auto" })).rejects.toThrow(
          /http:\/\/ or https:\/\//,
        )
        expect(f.calls.length).toBe(0)
      } finally {
        f.restore()
      }
    })

    test("webcrawl rejects a start URL outside the allowlist before the browser starts", async () => {
      process.env.NAVI_NETWORK_ALLOW = "allowed.test"
      const f = installFetch(() => undefined)
      try {
        await expect(exec(WebCrawlTool, { url: "https://denied.test/", maxPages: 1 })).rejects.toThrow(
          /NETWORK_BLOCKED/,
        )
        expect(callsFor(f.calls, "denied.test").length).toBe(0)
      } finally {
        f.restore()
      }
    })
  })

  describe("browser tool", () => {
    test("navigate refuses a denied host before launching the browser", async () => {
      process.env.NAVI_NETWORK_DENY = "blocked.test"
      const f = installFetch(() => undefined)
      try {
        await WithInstance.provide({
          directory: projectRoot,
          fn: async () => {
            await expect(exec(BrowserTool, { action: "navigate", url: "https://blocked.test/" })).rejects.toThrow(
              /NETWORK_BLOCKED/,
            )
          },
        })
        // Instance bootstrap may issue its own requests, but the denied URL
        // itself must never be requested.
        expect(f.calls.some((call) => call.url.includes("blocked.test"))).toBe(false)
      } finally {
        f.restore()
      }
    })
  })

  describe("duckduckgo search backend", () => {
    test("a denied host fails before fetch", async () => {
      process.env.NAVI_NETWORK_ALLOW = "other.test"
      const f = installFetch(() => undefined)
      try {
        await expect(exec(DuckDuckGoSearchTool, { query: "navi" })).rejects.toThrow(/NETWORK_BLOCKED/)
        expect(callsFor(f.calls, "api.duckduckgo.com").length).toBe(0)
      } finally {
        f.restore()
      }
    })

    test("an allowlisted host works and disables automatic redirects", async () => {
      process.env.NAVI_NETWORK_ALLOW = "api.duckduckgo.com"
      const f = installFetch((url) =>
        url.includes("api.duckduckgo.com") ? new Response(JSON.stringify({ AbstractText: "hello world" })) : undefined,
      )
      try {
        const result = await WithInstance.provide({
          directory: projectRoot,
          fn: async () => exec(DuckDuckGoSearchTool, { query: "navi" }),
        })
        expect(result.output).toContain("hello world")
        const providerCalls = f.calls.filter((call) => call.url.includes("api.duckduckgo.com"))
        expect(providerCalls.length).toBe(1)
        expect(providerCalls[0]!.init?.redirect).toBe("manual")
      } finally {
        f.restore()
      }
    })

    test("a redirect to a denied host is blocked and not followed", async () => {
      process.env.NAVI_NETWORK_ALLOW = "api.duckduckgo.com"
      const f = installFetch((url) =>
        url.includes("api.duckduckgo.com")
          ? new Response(null, { status: 302, headers: { location: "https://evil.test/collect" } })
          : undefined,
      )
      try {
        await expect(exec(DuckDuckGoSearchTool, { query: "navi" })).rejects.toThrow(/NETWORK_BLOCKED/)
        expect(callsFor(f.calls, "api.duckduckgo.com").length).toBe(1)
        expect(callsFor(f.calls, "evil.test").length).toBe(0)
      } finally {
        f.restore()
      }
    })

    test("no policy keeps the previous behaviour", async () => {
      const f = installFetch((url) =>
        url.includes("api.duckduckgo.com") ? new Response(JSON.stringify({ AbstractText: "unrestricted" })) : undefined,
      )
      try {
        const result = await WithInstance.provide({
          directory: projectRoot,
          fn: async () => exec(DuckDuckGoSearchTool, { query: "navi" }),
        })
        expect(result.output).toContain("unrestricted")
        expect(callsFor(f.calls, "api.duckduckgo.com").length).toBe(1)
      } finally {
        f.restore()
      }
    })
  })

  describe("http search providers", () => {
    test("a provider outside the allowlist is blocked before fetch", async () => {
      process.env.NAVI_NETWORK_ALLOW = "www.google.com"
      const f = installFetch(() => undefined)
      try {
        await expect(searchWithProvider("bing", "navi", 3)).rejects.toThrow(/NETWORK_BLOCKED/)
        expect(callsFor(f.calls, "bing.com").length).toBe(0)
      } finally {
        f.restore()
      }
    })

    test("a redirect into a denied host is blocked", async () => {
      process.env.NAVI_NETWORK_ALLOW = "www.google.com"
      const f = installFetch((url) =>
        url.includes("www.google.com")
          ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })
          : undefined,
      )
      try {
        await expect(searchWithProvider("google", "navi", 3)).rejects.toThrow(/NETWORK_BLOCKED/)
        expect(callsFor(f.calls, "www.google.com").length).toBe(1)
        expect(callsFor(f.calls, "169.254.169.254").length).toBe(0)
      } finally {
        f.restore()
      }
    })

    test("an allowlisted provider still returns parsed results", async () => {
      process.env.NAVI_NETWORK_ALLOW = "www.google.com"
      const html = '<div class="g"><a href="https://example.com/x"><h3>Hello</h3></a></div>'
      const f = installFetch((url) =>
        url.includes("www.google.com")
          ? new Response(html, { headers: { "content-type": "text/html" } })
          : undefined,
      )
      try {
        const results = await searchWithProvider("google", "navi", 3)
        expect(results[0]?.url).toBe("https://example.com/x")
        expect(results[0]?.title).toBe("Hello")
        expect(callsFor(f.calls, "www.google.com").length).toBe(1)
      } finally {
        f.restore()
      }
    })
  })

  describe("browser engine fetch", () => {
    test("fast path follows redirects when no policy is configured", async () => {
      const f = installFetch((url) => {
        if (!url.includes("allowed.test")) return undefined
        if (new URL(url).pathname === "/start") {
          return new Response(null, { status: 302, headers: { location: "/final" } })
        }
        return new Response(LONG_HTML, { headers: { "content-type": "text/html" } })
      })
      try {
        const result = await webFetch("https://allowed.test/start", "markdown")
        expect(result.content).toContain("lorem ipsum")
        const calls = callsFor(f.calls, "allowed.test")
        expect(calls.length).toBe(2)
        expect(calls[1]!.url).toBe("https://allowed.test/final")
      } finally {
        f.restore()
      }
    })

    test("fast path refuses a redirect into a denied private host", async () => {
      process.env.NAVI_NETWORK_ALLOW = "allowed.test"
      const f = installFetch((url) =>
        url.includes("allowed.test")
          ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } })
          : undefined,
      )
      try {
        await expect(webFetch("https://allowed.test/start", "markdown")).rejects.toThrow(/NETWORK_BLOCKED/)
        const calls = callsFor(f.calls, "allowed.test")
        expect(calls.length).toBe(1)
        expect(calls[0]!.init?.redirect).toBe("manual")
        expect(callsFor(f.calls, "169.254.169.254").length).toBe(0)
      } finally {
        f.restore()
      }
    })

    test("fast path serves an allowlisted host", async () => {
      process.env.NAVI_NETWORK_ALLOW = "allowed.test"
      const f = installFetch((url) =>
        url.includes("allowed.test") ? new Response(LONG_HTML, { headers: { "content-type": "text/html" } }) : undefined,
      )
      try {
        const result = await webFetch("https://allowed.test/page", "text")
        expect(result.content).toContain("lorem ipsum")
        expect(callsFor(f.calls, "allowed.test").length).toBe(1)
      } finally {
        f.restore()
      }
    })
  })

  describe("codesearch MCP backend", () => {
    test("a denied MCP endpoint fails before any request", async () => {
      process.env.NAVI_NETWORK_ALLOW = "allowed.test"
      const f = installFetch(() => undefined)
      try {
        await expect(exec(CodeSearchTool, { query: "useState", tokensNum: 2000 })).rejects.toThrow(/NETWORK_BLOCKED/)
        expect(callsFor(f.calls, "mcp.exa.ai").length).toBe(0)
      } finally {
        f.restore()
      }
    })
  })
})
