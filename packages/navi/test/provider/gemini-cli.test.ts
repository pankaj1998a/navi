import { beforeEach, expect, mock, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Env } from "../../src/env"

const authStore = new Map<string, any>()
const authMock = {
  get: async (providerID: string) => authStore.get(providerID),
  all: async () => Object.fromEntries(authStore),
  set: async (key: string, info: any) => {
    authStore.set(key, info)
  },
  remove: async (key: string) => {
    authStore.delete(key)
  },
}

const refreshAccessToken = mock(async () => ({
  credentials: {
    access_token: "refreshed-access-token",
    expiry_date: Date.now() + 60 * 60 * 1000,
  },
}))

mock.module("google-auth-library", () => ({
  OAuth2Client: class {
    constructor(_config?: Record<string, unknown>) {}
    setCredentials(_creds?: Record<string, unknown>) {}
    refreshAccessToken() {
      return refreshAccessToken()
    }
    generateAuthUrl() {
      return "https://example.invalid/auth"
    }
    getToken() {
      return Promise.resolve({
        tokens: {
          access_token: "token",
          refresh_token: "refresh",
          expiry_date: Date.now() + 60 * 60 * 1000,
        },
      })
    }
  },
}))

mock.module("../../src/auth", () => ({ Auth: authMock }))
mock.module("../../src/auth/index.ts", () => ({ Auth: authMock }))

const gemini = await import("../../src/provider/gemini-cli")

beforeEach(() => {
  authStore.clear()
  refreshAccessToken.mockClear()
  gemini.resetGeminiCliStateForTests()
})

test("Gemini OAuth client config honors env overrides", () => {
  const originalClientId = process.env.GEMINI_CLI_OAUTH_CLIENT_ID
  const originalClientSecret = process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET
  const originalLegacyClientId = process.env.GEMINI_CLIENT_ID
  const originalLegacyClientSecret = process.env.GEMINI_CLIENT_SECRET

  try {
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID = "override-client-id"
    process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET = "override-client-secret"
    process.env.GEMINI_CLIENT_ID = "legacy-client-id"
    process.env.GEMINI_CLIENT_SECRET = "legacy-client-secret"

    expect(gemini.getGeminiOAuthClientConfig()).toEqual({
      clientId: "override-client-id",
      clientSecret: "override-client-secret",
    })
  } finally {
    if (originalClientId === undefined) delete process.env.GEMINI_CLI_OAUTH_CLIENT_ID
    else process.env.GEMINI_CLI_OAUTH_CLIENT_ID = originalClientId

    if (originalClientSecret === undefined) delete process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET
    else process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET = originalClientSecret

    if (originalLegacyClientId === undefined) delete process.env.GEMINI_CLIENT_ID
    else process.env.GEMINI_CLIENT_ID = originalLegacyClientId

    if (originalLegacyClientSecret === undefined) delete process.env.GEMINI_CLIENT_SECRET
    else process.env.GEMINI_CLIENT_SECRET = originalLegacyClientSecret
  }
})

test("Gemini model aliases resolve to preview models", () => {
  expect(gemini.resolveGeminiModelID("gemini-3-pro")).toBe("gemini-3-pro-preview")
  expect(gemini.resolveGeminiModelID("gemini-3-flash")).toBe("gemini-3-flash-preview")
  expect(gemini.resolveGeminiModelID("gemini-2.5-pro")).toBe("gemini-2.5-pro")
})

test("Gemini fetch routes Google AI requests through Code Assist with bearer auth", async () => {
  authStore.clear()
  authStore.set("gemini-cli", {
    type: "oauth",
    access: "test-access-token",
    refresh: "test-refresh-token",
    expires: Date.now() + 60 * 60 * 1000,
  })

  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    calls.push({ url, init })

    if (url.includes("cloudcode-pa.googleapis.com") && url.includes(":loadCodeAssist")) {
      return new Response(JSON.stringify({ cloudaicompanionProject: "project-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.includes("cloudcode-pa.googleapis.com") && url.includes(":generateContent")) {
      const headers = new Headers(init?.headers)
      expect(headers.get("Authorization")).toBe("Bearer test-access-token")
      expect(headers.get("x-goog-api-key")).toBeNull()

      const payload = JSON.parse((init?.body as string) ?? "{}") as {
        model?: string
        project?: string
        request?: { contents?: unknown[] }
      }
      expect(payload.model).toBe("gemini-2.5-pro")
      expect(payload.project).toBe("project-123")
      expect(payload.request?.contents).toBeDefined()

      return new Response(JSON.stringify({ response: { candidates: [{ content: "ok" }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    const response = await gemini.geminiCliFetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": "should-be-removed",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
        }),
      },
    )

    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ candidates: [{ content: "ok" }] })
    expect(calls.some((call) => call.url.includes(":loadCodeAssist"))).toBe(true)
    expect(calls.some((call) => call.url.includes(":generateContent"))).toBe(true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Gemini Code Assist project cache is keyed by account", async () => {
  authStore.set("gemini-cli", {
    type: "oauth",
    access: "account-a-access",
    refresh: "refresh-a",
    expires: Date.now() + 60 * 60 * 1000,
    accountId: "account-a@example.com",
  })

  const originalFetch = globalThis.fetch
  const loadCalls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    if (url.includes("cloudcode-pa.googleapis.com") && url.includes(":loadCodeAssist")) {
      loadCalls.push(url)
      const headers = new Headers(init?.headers)
      expect(headers.get("Authorization")).toBe("Bearer account-a-access")
      return new Response(JSON.stringify({ cloudaicompanionProject: "project-a" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.includes("cloudcode-pa.googleapis.com") && url.includes(":generateContent")) {
      return new Response(JSON.stringify({ response: { candidates: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    await gemini.geminiCliFetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", {
      method: "POST",
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "one" }] }] }),
    })

    authStore.set("gemini-cli", {
      type: "oauth",
      access: "account-b-access",
      refresh: "refresh-b",
      expires: Date.now() + 60 * 60 * 1000,
      accountId: "account-b@example.com",
    })

    await gemini.geminiCliFetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", {
      method: "POST",
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "two" }] }] }),
    })

    expect(loadCalls).toHaveLength(2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Gemini Code Assist uses GOOGLE_CLOUD_PROJECT as a project hint", async () => {
  await using tmp = await tmpdir()
  authStore.set("gemini-cli", {
    type: "oauth",
    access: "hint-access-token",
    refresh: "hint-refresh-token",
    expires: Date.now() + 60 * 60 * 1000,
    accountId: "hint@example.com",
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString()
    if (url.includes("cloudcode-pa.googleapis.com") && url.includes(":loadCodeAssist")) {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        cloudaicompanionProject?: string
        metadata?: { duetProject?: string }
      }
      expect(body.cloudaicompanionProject).toBe("env-project")
      expect(body.metadata?.duetProject).toBe("env-project")
      return new Response(JSON.stringify({ cloudaicompanionProject: "server-project" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.includes("cloudcode-pa.googleapis.com") && url.includes(":generateContent")) {
      return new Response(JSON.stringify({ response: { candidates: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch

  try {
    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("GOOGLE_CLOUD_PROJECT", "env-project")
      },
      fn: async () => {
        await gemini.geminiCliFetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", {
          method: "POST",
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hint" }] }] }),
        })
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Gemini access token refreshes expired oauth credentials", async () => {
  authStore.set("gemini-cli", {
    type: "oauth",
    access: "expired-access-token",
    refresh: "refresh-token",
    expires: Date.now() - 10 * 60 * 1000,
  })

  const token = await gemini.getAccessToken()
  expect(token).toBe("refreshed-access-token")
  expect(refreshAccessToken).toHaveBeenCalled()
  expect(authStore.get("gemini-cli")?.access).toBe("refreshed-access-token")
})
