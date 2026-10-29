import { test, expect, mock } from "bun:test"
import { Option, Schema } from "effect"
import { Auth } from "../../src/auth"
import type { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { OpenCodeProvider } from "../../src/provider/providers/opencode"
import { loginWithDeviceFlow, requestDeviceCode } from "../../src/provider/opencode-device"

// Isolate the provider from ambient machine credentials (env vars, on-disk
// opencode auth.json): these tests define "no credentials" via the dep only.
let detectedLocalAuth: { apiKey?: string } | undefined = undefined
mock.module("../../src/plugin/opencode", () => ({
  detectOpenCodeLocalAuth: async () => detectedLocalAuth,
  checkOpenCodeServer: async () => false,
  ensureOpenCodeServer: async () => undefined,
  findOpenCodeExecutable: () => undefined,
}))

function consoleServer() {
  let tokenCalls = 0
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path === "/auth/device/code") {
        return Response.json({
          device_code: "device",
          user_code: "ABCD-1234",
          verification_uri_complete: "/device?user_code=ABCD-1234",
          expires_in: 60,
          interval: 0,
        })
      }
      if (path === "/auth/device/token") {
        tokenCalls += 1
        if (tokenCalls === 1) return Response.json({ error: "authorization_pending" })
        return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 600, org_id: null })
      }
      if (path === "/api/user") return Response.json({ id: "user", email: "user@example.com" })
      if (path === "/api/orgs") {
        return Response.json([
          { id: "org-z", name: "Zebra" },
          { id: "org-a", name: "Alpha" },
        ])
      }
      if (path === "/models") return Response.json({ data: [] })
      return new Response("Not found", { status: 404 })
    },
  })
  return server
}

function model(id: string, input: number): Provider.Model {
  return {
    id: ModelID.make(id),
    providerID: ProviderID.make("opencode"),
    api: { id, url: "https://opencode.ai/zen/v1", npm: "@ai-sdk/openai-compatible" },
    name: id,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 16384 },
    status: "active",
    options: {},
    headers: {},
    release_date: new Date().toISOString(),
    variants: {},
  }
}

function input(id: string, models: Record<string, Provider.Model>): Provider.Info {
  return { id: ProviderID.make(id), name: id, source: "custom", env: [], options: {}, models }
}

const noAuth = async () => undefined

test("requests a device code from the console server", async () => {
  const server = consoleServer()
  try {
    const device = await requestDeviceCode(fetch, server.url.toString())
    expect(device.device_code).toBe("device")
    expect(device.user_code).toBe("ABCD-1234")
  } finally {
    server.stop(true)
  }
})

test("polls until approval, then resolves user and default org", async () => {
  const server = consoleServer()
  try {
    const base = server.url.toString()
    const device = await requestDeviceCode(fetch, base)
    const login = await loginWithDeviceFlow(fetch, base, device)
    expect(login.access).toBe("access")
    expect(login.refresh).toBe("refresh")
    expect(login.accountId).toBe("user")
    expect(login.enterpriseUrl).toBe(base.replace(/\/+$/, ""))
    expect(login.metadata.email).toBe("user@example.com")
    expect(login.metadata.orgID).toBe("org-a")
    expect(login.metadata.orgName).toBe("Alpha")
  } finally {
    server.stop(true)
  }
})

test("keeps free models without credentials", async () => {
  detectedLocalAuth = undefined
  const result = await OpenCodeProvider.load(input("opencode", { free: model("free", 0), paid: model("paid", 1) }), {
    auth: noAuth,
    config: {} as Config.Info,
    env: {},
  })
  expect(result.options?.apiKey).toBeUndefined()
  expect(result.models?.["free"]).toBeDefined()
  expect(result.models?.["paid"]).toBeUndefined()
  for (const m of Object.values(result.models ?? {})) {
    expect((m as Provider.Model).cost.input).toBe(0)
  }
})

test("uses local CLI credentials when nothing else is configured", async () => {
  detectedLocalAuth = { apiKey: "local-key" }
  try {
    const result = await OpenCodeProvider.load(input("opencode", { free: model("free", 0), paid: model("paid", 1) }), {
      auth: noAuth,
      config: {} as Config.Info,
      env: {},
    })
    expect(result.options?.apiKey).toBe("local-key")
    expect(result.models?.["paid"]).toBeDefined()
  } finally {
    detectedLocalAuth = undefined
  }
})

test("keeps paid models with credentials", async () => {
  const server = consoleServer()
  try {
    const result = await OpenCodeProvider.load(input("opencode", { free: model("free", 0), paid: model("paid", 1) }), {
      auth: async () => ({ type: "api", key: "secret" }) as Auth.Info,
      config: { provider: { opencode: { options: { baseURL: server.url.toString() } } } } as unknown as Config.Info,
      env: {},
    })
    expect(result.options?.apiKey).toBe("secret")
    expect(result.models?.["paid"]).toBeDefined()
  } finally {
    server.stop(true)
  }
})

test("decodes legacy auth.json records without metadata", () => {
  const decode = Schema.decodeUnknownOption(Auth.Info)
  expect(Option.isSome(decode({ type: "api", key: "x" }))).toBe(true)
  const oauth = decode({ type: "oauth", refresh: "r", access: "a", expires: 123 })
  expect(Option.isSome(oauth)).toBe(true)
})
