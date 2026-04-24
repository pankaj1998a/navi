/**
 * Gemini CLI OAuth provider for Navi.
 *
 * This mirrors the Gemini CLI sign-in flow closely enough for Navi's auth
 * store and provider loader, while keeping the implementation self-contained.
 */

import type { Hooks, AuthHook, AuthOuathResult, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import { Env } from "../env"
import { Log } from "../util/log"
import { readFile } from "fs/promises"
import { homedir } from "os"
import { join } from "path"
import { generatePKCEParams, startCallbackServer, buildAuthorizationUrl, exchangeCodeForToken } from "../auth/oauth/flow"
import { openBrowserSecurely, shouldLaunchBrowser } from "../auth/oauth/browser"

const log = Log.create({ service: "gemini-cli" })

const DEFAULT_GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const DEFAULT_GEMINI_CLIENT_SECRET = "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"
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta"
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"
const GEMINI_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]
const SIGN_IN_SUCCESS_URL = "https://developers.google.com/gemini-code-assist/auth_success_gemini"
const SIGN_IN_FAILURE_URL = "https://developers.google.com/gemini-code-assist/auth_failure_gemini"
const SYNTHETIC_THOUGHT_SIGNATURE = "skip_thought_signature_validator"

const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"

let skipGeminiFileMigration = false
const cachedProjectIds = new Map<string, string>()

export const GEMINI_MODELS = {
  "gemini-3.1-pro-preview": {
    name: "Gemini 3.1 Pro Preview",
    id: "gemini-3.1-pro-preview",
    providerID: "gemini-cli",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 1048576, input: 1048576, output: 65535 },
    cost: { input: 0, output: 0 },
    status: "active" as const,
    release_date: "",
  },
  "gemini-3-pro-preview": {
    name: "Gemini 3 Pro Preview",
    id: "gemini-3-pro-preview",
    providerID: "gemini-cli",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 1048576, input: 1048576, output: 65535 },
    cost: { input: 0, output: 0 },
    status: "active" as const,
    release_date: "",
  },
  "gemini-3-flash-preview": {
    name: "Gemini 3 Flash Preview",
    id: "gemini-3-flash-preview",
    providerID: "gemini-cli",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 1048576, input: 1048576, output: 65535 },
    cost: { input: 0, output: 0 },
    status: "active" as const,
    release_date: "",
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    id: "gemini-2.5-pro",
    providerID: "gemini-cli",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 1048576, input: 1048576, output: 8192 },
    cost: { input: 0, output: 0 },
    status: "active" as const,
    release_date: "",
  },
  "gemini-2.5-flash": {
    name: "Gemini 2.5 Flash",
    id: "gemini-2.5-flash",
    providerID: "gemini-cli",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 1048576, input: 1048576, output: 8192 },
    cost: { input: 0, output: 0 },
    status: "active" as const,
    release_date: "",
  },
  "gemini-2.5-flash-lite": {
    name: "Gemini 2.5 Flash Lite",
    id: "gemini-2.5-flash-lite",
    providerID: "gemini-cli",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    limit: { context: 1048576, input: 1048576, output: 8192 },
    cost: { input: 0, output: 0 },
    status: "active" as const,
    release_date: "",
  },
} as const

const GEMINI_MODEL_ALIASES: Record<string, string> = {
  "gemini-3-pro": "gemini-3-pro-preview",
  "gemini-3-flash": "gemini-3-flash-preview",
  "gemini-3.1-pro": "gemini-3.1-pro-preview",
}

interface GeminiAuth {
  access: string
  refresh: string
  expires: number
  accountId?: string
  resourceUrl?: string
}

export function resolveGeminiModelID(modelID: string): string {
  return GEMINI_MODEL_ALIASES[modelID] ?? modelID
}

export function getGeminiOAuthClientConfig() {
  const clientId =
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID?.trim() ||
    process.env.GEMINI_CLIENT_ID?.trim() ||
    DEFAULT_GEMINI_CLIENT_ID
  const clientSecret =
    process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.GEMINI_CLIENT_SECRET?.trim() ||
    DEFAULT_GEMINI_CLIENT_SECRET

  return { clientId, clientSecret }
}

export function resetGeminiCliStateForTests() {
  skipGeminiFileMigration = false
  cachedProjectIds.clear()
}

function normalizeBaseURL(resourceUrl?: string): string {
  const base = resourceUrl && resourceUrl.trim() ? resourceUrl : GEMINI_API_URL
  return base.replace(/\/+$/, "")
}

function getGeminiProjectHint(): string | undefined {
  try {
    return Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GOOGLE_CLOUD_PROJECT_ID") ?? undefined
  } catch {
    return undefined
  }
}

async function readGeminiCliCredentials(): Promise<GeminiAuth | null> {
  try {
    const filePath = join(homedir(), ".gemini", "oauth_creds.json")
    const raw = await readFile(filePath, "utf8")
    const creds = JSON.parse(raw) as {
      access_token?: string
      refresh_token?: string
      expiry_date?: number
      resource_url?: string
      email?: string
    }

    if (!creds.access_token) return null
    if (!creds.refresh_token && creds.expiry_date && Date.now() > creds.expiry_date - 5 * 60 * 1000) return null

    return {
      access: creds.access_token,
      refresh: creds.refresh_token ?? "",
      expires: creds.expiry_date ?? Date.now() + 3500 * 1000,
      accountId: creds.email,
      resourceUrl: normalizeBaseURL(creds.resource_url),
    }
  } catch {
    return null
  }
}

async function refreshToken(refreshToken: string): Promise<{ access: string; expires: number; resourceUrl?: string }> {
  const { clientId, clientSecret } = getGeminiOAuthClientConfig()
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })
  if (clientSecret) params.append("client_secret", clientSecret)

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status} - ${await response.text()}`)
  }

  const tokens = (await response.json()) as { access_token: string; expiry_date?: number }
  return {
    access: tokens.access_token,
    expires: tokens.expiry_date ?? Date.now() + 3500 * 1000,
    resourceUrl: undefined,
  }
}

async function getGeminiCliProjectId(token: string, cacheKey: string, projectHint?: string): Promise<string | undefined> {
  const cachedProjectId = cachedProjectIds.get(cacheKey)
  if (cachedProjectId) return cachedProjectId

  const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      cloudaicompanionProject: projectHint,
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
        duetProject: projectHint,
      },
    }),
  })

  if (response.status === 401) throw new Error("TOKEN_EXPIRED")
  if (!response.ok) return undefined

  const data = (await response.json()) as { cloudaicompanionProject?: string }
  const projectId = data.cloudaicompanionProject ?? projectHint
  if (projectId) cachedProjectIds.set(cacheKey, projectId)
  return projectId
}

function parseGoogleAIUrl(input: RequestInfo | URL): { model: string; method: string } | null {
  try {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
    const pathname = new URL(urlStr).pathname
    // Handle both /models/model-id and /v1beta/models/model-id
    const match = pathname.match(/\/(?:models\/)+(?:models\/)?([^:/?#]+):(generateContent|streamGenerateContent|countTokens)$/)
    if (!match) return null
    return { model: match[1], method: match[2] }
  } catch {
    return null
  }
}

function extractRequestBody(body: RequestInit["body"]): string {
  if (typeof body === "string") return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8")
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer as ArrayBuffer).toString("utf8")
  return "{}"
}

function toPart(part: any): any {
  if (typeof part === "string") return { text: part }
  if (part && typeof part === "object" && "thought" in part && part.thought) {
    const cloned = { ...part }
    delete cloned.thought
    if (!("functionCall" in cloned) && !("functionResponse" in cloned) && !("inlineData" in cloned) && !("fileData" in cloned)) {
      const text = String(cloned.text ?? "")
      cloned.text = text ? `${text}\n[Thought: ${part.thought}]` : `[Thought: ${part.thought}]`
    }
    return cloned
  }
  return part
}

function toContent(content: any): any {
  if (typeof content === "string") return { role: "user", parts: [{ text: content }] }
  if (Array.isArray(content)) return { role: "user", parts: content.map(toPart) }
  if (content && typeof content === "object" && !("parts" in content)) return { role: "user", parts: [toPart(content)] }
  if (content && content.parts) return { ...content, parts: content.parts.filter(Boolean).map(toPart) }
  return content
}

function toContents(contents: any): any[] {
  if (Array.isArray(contents)) return contents.map(toContent)
  return [toContent(contents)]
}

async function callCodeAssist(input: RequestInfo | URL, init: RequestInit | undefined, token: string): Promise<Response | null> {
  const parsed = parseGoogleAIUrl(input)
  if (!parsed) return null
  const auth = await getGeminiAuth()
  const projectCacheKey = auth?.accountId ?? auth?.refresh ?? auth?.access ?? token
  const projectHint = getGeminiProjectHint()

  const rawBody = extractRequestBody(init?.body)
  const body = JSON.parse(rawBody || "{}") as Record<string, any>
  const contents = toContents(body.contents || [])
  const systemInstruction = body.systemInstruction ? toContent(body.systemInstruction) : undefined

  for (const content of contents) {
    if (!content?.parts || !Array.isArray(content.parts)) continue
    for (const part of content.parts) {
      if (part.functionCall && !part.thoughtSignature) {
        part.thoughtSignature = SYNTHETIC_THOUGHT_SIGNATURE
      }
    }
  }

  const projectId = await getGeminiCliProjectId(token, projectCacheKey, projectHint).catch((error) => {
    if ((error as Error)?.message === "TOKEN_EXPIRED") throw error
    return undefined
  })
  if (!projectId) throw new Error("NO_CODE_ASSIST_PROJECT")

  const requestPayload = {
    model: parsed.model,
    project: projectId,
    user_prompt_id: `navi-${Date.now()}`,
    request: {
      contents,
      systemInstruction,
      cachedContent: body.cachedContent,
      tools: body.tools,
      toolConfig: body.toolConfig,
      labels: body.labels,
      safetySettings: body.safetySettings,
      generationConfig: body.generationConfig,
    },
  }

  const endpoint =
    parsed.method === "countTokens"
      ? `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:countTokens`
      : parsed.method === "streamGenerateContent"
        ? `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`
        : `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`

  const headers = new Headers(init?.headers)
  headers.set("Content-Type", "application/json")
  headers.set("Authorization", `Bearer ${token}`)
  headers.delete("x-goog-api-key")

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestPayload),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    log.error("Gemini CLI: Code Assist call failed", { status: response.status, text, model: parsed.model })
    if (response.status === 403 && text.includes("insufficient authentication scopes")) {
      throw new Error("INSUFFICIENT_SCOPES")
    }
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  if (parsed.method === "streamGenerateContent") {
    const originalBody = response.body
    if (!originalBody) return new Response(null, { status: response.status, statusText: response.statusText })

    let buffer = ""
    const transformedStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += new TextDecoder().decode(chunk, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith("data: ")) continue
          const payload = trimmed.slice(6).trim()
          if (payload === "[DONE]") continue
          try {
            const parsed = JSON.parse(payload) as { response?: unknown }
            const result = parsed.response ?? parsed
            controller.enqueue(new TextEncoder().encode(JSON.stringify(result) + "\n"))
          } catch {
            // Ignore malformed chunks
          }
        }
      },
      flush(controller) {
        if (!buffer.trim()) return
        let line = buffer.trim()
        if (line.startsWith("data: ")) {
          const payload = line.slice(6).trim()
          if (payload !== "[DONE]") {
            try {
              const parsed = JSON.parse(payload) as { response?: unknown }
              const result = parsed.response ?? parsed
              controller.enqueue(new TextEncoder().encode(JSON.stringify(result) + "\n"))
            } catch {
              /* ignore */
            }
          }
        }
      },
    })

    originalBody.pipeTo(transformedStream.writable).catch((error) => {
      log.error("Gemini CLI: stream pipe error", { error: String(error) })
    })

    return new Response(transformedStream.readable, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  if (parsed.method === "countTokens") {
    const data = await response.json().catch(() => undefined)
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers: { "Content-Type": "application/json" },
    })
  }

  const data = (await response.json().catch(() => undefined)) as { response?: unknown } | undefined
  return new Response(JSON.stringify(data?.response ?? data ?? {}), {
    status: response.status,
    statusText: response.statusText,
    headers: { "Content-Type": "application/json" },
  })
}

async function getGeminiAuth(forceRefresh = false): Promise<GeminiAuth | null> {
  const auth = await Auth.get("gemini-cli")
  if (auth && auth.type === "oauth") {
    skipGeminiFileMigration = false
    const stored = auth as typeof auth & { accountId?: string; resourceUrl?: string }
    return {
      access: stored.access,
      refresh: stored.refresh,
      expires: stored.expires,
      accountId: stored.accountId,
      resourceUrl: stored.resourceUrl,
    }
  }

  if (skipGeminiFileMigration) return null

  if (!forceRefresh) {
    const migrated = await readGeminiCliCredentials()
    if (migrated) {
      await Auth.set("gemini-cli", {
        type: "oauth",
        access: migrated.access,
        refresh: migrated.refresh,
        expires: migrated.expires,
        accountId: migrated.accountId,
        resourceUrl: migrated.resourceUrl,
      })
      return migrated
    }
  }

  return null
}

export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  try {
    const auth = await getGeminiAuth(forceRefresh)
    if (!auth) return null

    if (forceRefresh || auth.expires < Date.now() + 5 * 60 * 1000) {
      if (!auth.refresh) return auth.access
      try {
        const refreshed = await refreshToken(auth.refresh)
        await Auth.set("gemini-cli", {
          type: "oauth",
          access: refreshed.access,
          refresh: auth.refresh,
          expires: refreshed.expires,
          accountId: auth.accountId,
          resourceUrl: refreshed.resourceUrl ?? auth.resourceUrl,
        })
        return refreshed.access
      } catch (error) {
        log.warn("Gemini CLI: token refresh failed, using existing token", { error: String(error) })
        return auth.access
      }
    }

    return auth.access
  } catch (error) {
    log.error("Gemini CLI: failed to get access token", { error: String(error) })
    return null
  }
}

export async function geminiCliFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let token = await getAccessToken()
  if (!token) {
    throw new Error("Unauthorized: No gemini-cli token. Run 'navi auth login gemini-cli'")
  }

  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const parsed = parseGoogleAIUrl(input)
      const caResponse = await callCodeAssist(input, init, token)
      if (caResponse) {
        if (caResponse.ok) return caResponse
        if (caResponse.status === 401 || caResponse.status === 403) {
          if (attempt < maxAttempts) {
            token = (await getAccessToken(true)) ?? token
            continue
          }
        }
        // Fallback to direct fetch for 400 Bad Request (e.g. model not supported by Code Assist)
        if (caResponse.status !== 400) {
          return caResponse
        }
        log.warn("Gemini CLI: Code Assist call failed, falling back to direct API", { status: caResponse.status, model: parsed?.model })
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "TOKEN_EXPIRED") {
          token = (await getAccessToken(true)) ?? token
          continue
        }
        if (error.message === "INSUFFICIENT_SCOPES") {
          skipGeminiFileMigration = true
          await Auth.remove("gemini-cli")
          throw new Error("Gemini CLI: insufficient authentication scopes. Please log in again with `navi auth login gemini-cli`.")
        }
        if (error.message === "NO_CODE_ASSIST_PROJECT") {
          throw new Error("Gemini CLI: your account does not have Gemini Code Assist access.")
        }
      }
      throw error
    }

    const directHeaders = new Headers(init?.headers)
    directHeaders.set("Authorization", `Bearer ${token}`)
    directHeaders.delete("x-goog-api-key")

    const directResponse = await fetch(input, { ...init, headers: directHeaders })
    if (directResponse.ok) return directResponse

    if (directResponse.status === 401 || directResponse.status === 403) {
      if (attempt < maxAttempts) {
        token = (await getAccessToken(true)) ?? token
        continue
      }
    }

    return directResponse
  }

  throw new Error("Gemini CLI: authentication failed after multiple attempts.")
}

export const GeminiAuthHook: AuthHook = {
  provider: "gemini-cli",

  async loader(getAuth) {
    const auth = await getAuth()
    if (!auth || auth.type !== "oauth") {
      return {
        apiKey: "NOT_USED",
        baseURL: GEMINI_API_URL,
        fetch: geminiCliFetch,
      }
    }

    if (auth.expires < Date.now() + 5 * 60 * 1000) {
      try {
        const refreshed = await refreshToken(auth.refresh)
        await Auth.set("gemini-cli", {
          ...auth,
          access: refreshed.access,
          expires: refreshed.expires,
        })
      } catch (error) {
        log.warn("Gemini CLI: token refresh during load failed", { error: String(error) })
      }
    }

    return {
      apiKey: "NOT_USED",
      baseURL: (auth as any).resourceUrl || GEMINI_API_URL,
      fetch: geminiCliFetch,
    }
  },

  methods: [
    {
      type: "oauth",
      label: "OAuth with Google (Gemini CLI)",
      async authorize(): Promise<AuthOuathResult> {
        const { clientId, clientSecret } = getGeminiOAuthClientConfig()
        const pkce = generatePKCEParams()
        const config = {
          clientId,
          clientSecret,
          authorizationUrl: GOOGLE_OAUTH_AUTH_URL,
          tokenUrl: GOOGLE_OAUTH_TOKEN_URL,
          scopes: GEMINI_SCOPES,
        }

        if (shouldLaunchBrowser()) {
          const { port, response } = startCallbackServer(pkce.state)
          const redirectPort = await port
          const authUrl = buildAuthorizationUrl(config, pkce, redirectPort)

          openBrowserSecurely(authUrl).catch((error) => {
            log.warn("Gemini CLI: failed to open browser", { error: String(error) })
          })

          return {
            url: authUrl,
            instructions: "Complete sign-in in your browser. Navi will continue automatically.",
            method: "auto",
            async callback() {
              try {
                const { code } = await response
                const tokens = await exchangeCodeForToken(config, code, pkce.codeVerifier, redirectPort)

                let email = "unknown"
                try {
                  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
                    headers: { Authorization: `Bearer ${tokens.access_token}` },
                  })
                  if (userInfoRes.ok) {
                    const info = (await userInfoRes.json()) as { email?: string }
                    email = info.email || email
                  }
                } catch {
                  /* ignore */
                }

                return {
                  type: "success",
                  provider: "gemini-cli",
                  refresh: tokens.refresh_token!,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3500) * 1000,
                  accountId: email,
                }
              } catch (error) {
                log.error("Gemini CLI: OAuth callback failed", { error: String(error) })
                return { type: "failed" }
              }
            },
          }
        } else {
          const redirectUri = "https://codeassist.google.com/authcode"
          const authUrl = buildAuthorizationUrl({ ...config, redirectUri }, pkce, 0)

          return {
            url: authUrl,
            instructions: "Please visit the URL above, authorize the application, and paste the code here.",
            method: "code",
            async callback(code) {
              if (!code) return { type: "failed" }
              try {
                const tokens = await exchangeCodeForToken(
                  { ...config, redirectUri },
                  code,
                  pkce.codeVerifier,
                  0
                )

                let email = "unknown"
                try {
                  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
                    headers: { Authorization: `Bearer ${tokens.access_token}` },
                  })
                  if (userInfoRes.ok) {
                    const info = (await userInfoRes.json()) as { email?: string }
                    email = info.email || email
                  }
                } catch {
                  /* ignore */
                }

                return {
                  type: "success",
                  provider: "gemini-cli",
                  refresh: tokens.refresh_token!,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3500) * 1000,
                  accountId: email,
                }
              } catch (error) {
                log.error("Gemini CLI: Manual OAuth exchange failed", { error: String(error) })
                return { type: "failed" }
              }
            },
          }
        }
      },
    },
  ],
}

export async function discoverModels(): Promise<Record<string, any>> {
  const token = await getAccessToken()
  if (!token) return {}

  try {
    const response = await fetch(`${GEMINI_API_URL}/models?pageSize=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) return {}

    const data = (await response.json()) as { models?: any[] }
    if (!data.models) return {}

    const models: Record<string, any> = {}
    for (const m of data.models) {
      const id = m.name.replace("models/", "")
      // Only include models that are supported for generation
      if (!m.supportedGenerationMethods?.includes("generateContent")) continue

      models[id] = {
        id,
        providerID: "gemini-cli",
        name: m.displayName || id,
        family: m.family || "",
        limit: {
          context: m.inputTokenLimit || 1048576,
          input: m.inputTokenLimit || 1048576,
          output: m.outputTokenLimit || 65535,
        },
        capabilities: {
          temperature: true,
          reasoning: m.name.includes("pro") || m.name.includes("preview"),
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: id.includes("pro") || id.includes("flash"),
            image: true,
            video: true,
            pdf: id.includes("1.5") || id.includes("2.0") || id.includes("flash"),
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        api: {
          id,
          npm: "gemini-cli",
          url: GEMINI_API_URL,
        },
        status: "active",
        release_date: "",
        cost: {
          input: 0,
          output: 0,
          cache: { read: 0, write: 0 },
        },
        headers: {},
        options: {},
      }
    }

    return models
  } catch (error) {
    log.warn("Gemini CLI: model discovery failed", { error: String(error) })
    return {}
  }
}

export async function GeminiAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return { auth: GeminiAuthHook }
}
