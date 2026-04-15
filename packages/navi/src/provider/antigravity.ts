/**
 * Antigravity OAuth Provider for Navi
 *
 * Provides Google OAuth authentication for accessing Google's Antigravity IDE
 * which grants access to advanced Gemini and Claude models with higher quotas.
 *
 * Based on navi-antigravity-auth by NoeFabris
 * @see https://github.com/NoeFabris/navi-antigravity-auth
 */

import type { Hooks, AuthHook, AuthOuathResult, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import { Log } from "../util/log"
import http from "http"
import open from "open"
import { URL } from "url"
import crypto from "crypto"

const log = Log.create({ service: "antigravity" })

// Antigravity OAuth configuration (from navi-antigravity-auth)
const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || "_PLACEHOLDER_SECRET_"
const ANTIGRAVITY_REDIRECT_URI = "http://127.0.0.1:51121/oauth2callback"
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

// OAuth Scopes for Antigravity
// IMPORTANT: Only these scopes are registered for the Antigravity OAuth client.
// Do NOT add generative-language — it is not whitelisted and causes 403 restricted_client.
// The cloudcode-pa.googleapis.com endpoint accepts cloud-platform tokens.
const ANTIGRAVITY_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
]

// Antigravity API configuration
// Uses the internal Google Cloud Code PA endpoint (same as Code Assist / gemini-cli)
// which accepts cloud-platform tokens and supports antigravity model quotas.
export const ANTIGRAVITY_BASE_URL = "https://cloudcode-pa.googleapis.com"
export const ANTIGRAVITY_API_VERSION = "v1internal"
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc"

/**
 * Antigravity model definitions — matches models available via the Antigravity IDE quota.
 * Reference: https://github.com/NoeFabris/Navi-antigravity-auth
 */
export const ANTIGRAVITY_MODELS = {
    // Gemini 3.1 Pro — High thinking (strongest reasoning)
    "antigravity-gemini-3.1-pro-high": {
        name: "Gemini 3.1 Pro (High)",
        id: "antigravity-gemini-3.1-pro",
        thinking: true,
        attachment: true,
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    // Gemini 3.1 Pro — Low thinking (faster, lower latency)
    "antigravity-gemini-3.1-pro-low": {
        name: "Gemini 3.1 Pro (Low)",
        id: "antigravity-gemini-3.1-pro",
        thinking: false,
        attachment: true,
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    // Gemini 3 Flash — fast, supports thinking modes
    "antigravity-gemini-3-flash": {
        name: "Gemini 3 Flash",
        id: "antigravity-gemini-3-flash",
        thinking: false,
        attachment: true,
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    // Claude Sonnet 4.6 — extended thinking
    "antigravity-claude-sonnet-4-6": {
        name: "Claude Sonnet 4.6 (Thinking)",
        id: "antigravity-claude-sonnet-4-6",
        thinking: true,
        attachment: true,
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    // Claude Opus 4.6 — extended thinking (most powerful Claude)
    "antigravity-claude-opus-4-6-thinking": {
        name: "Claude Opus 4.6 (Thinking)",
        id: "antigravity-claude-opus-4-6-thinking",
        thinking: true,
        attachment: true,
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    // GPT-OSS 120B — OpenAI open-weight model (medium reasoning)
    "antigravity-gpt-oss-120b": {
        name: "GPT-OSS 120B (Medium)",
        id: "gpt-oss-120b",
        thinking: false,
        attachment: false,
        limit: { context: 128000, output: 16384 },
        modalities: { input: ["text"], output: ["text"] },
    },
} as const

export type AntigravityModelID = keyof typeof ANTIGRAVITY_MODELS

interface AntigravityAccount {
    email: string
    refresh: string
    access: string
    expires: number
}

interface AntigravityState {
    accounts: AntigravityAccount[]
    currentIndex: number
}

interface AntigravityAuthState {
    verifier: string
    projectId: string
}

/**
 * PKCE challenge/verifier pair
 */
interface PKCEPair {
    challenge: string
    verifier: string
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): PKCEPair {
    const verifier = crypto.randomBytes(32).toString("base64url")
    const challenge = crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url")

    return { verifier, challenge }
}

/**
 * Encode auth state to base64url
 */
function encodeState(state: AntigravityAuthState): string {
    return Buffer.from(JSON.stringify(state)).toString("base64url")
}

/**
 * Decode auth state from base64url
 */
function decodeState(state: string): AntigravityAuthState {
    const normalized = state.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
    const json = Buffer.from(padded, "base64").toString("utf8")
    const parsed = JSON.parse(json)

    return {
        verifier: parsed.verifier || "",
        projectId: parsed.projectId || "",
    }
}

/**
 * Get current auth state from storage
 */
async function getState(): Promise<AntigravityState> {
    const auth = await Auth.get("google-antigravity")
    const accounts: AntigravityAccount[] = []

    if (auth && auth.type === "oauth") {
        const authWithAccount = auth as typeof auth & { accountId?: string }
        accounts.push({
            email: authWithAccount.accountId || "unknown",
            refresh: auth.refresh,
            access: auth.access,
            expires: auth.expires,
        })
    }

    return {
        accounts,
        currentIndex: 0,
    }
}

/**
 * Refresh an OAuth token
 */
async function refreshToken(refreshToken: string): Promise<{ access: string; expires: number }> {
    try {
        // Extract project ID from stored refresh token (format: token|projectId)
        const [actualRefreshToken, projectId] = refreshToken.includes("|")
            ? refreshToken.split("|")
            : [refreshToken, ""]

        const response = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                refresh_token: actualRefreshToken,
                grant_type: "refresh_token",
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            const errorMessage = `Token refresh failed with status ${response.status}: ${errorText}`
            log.error(errorMessage)
            throw new Error(errorMessage)
        }

        const data = (await response.json()) as { access_token: string; expires_in: number }
        return {
            access: data.access_token,
            expires: Date.now() + data.expires_in * 1000,
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log.error("Token refresh error", { error: errorMessage })
        throw error // Re-throw the error to be handled by the caller
    }
}

/**
 * Get a valid access token, refreshing if needed
 */
export async function getAccessToken(forceRefresh = false): Promise<string | null> {
    try {
        const state = await getState()
        if (state.accounts.length === 0) {
            log.info("No accounts found for Antigravity")
            return null
        }

        const account = state.accounts[state.currentIndex]
        if (!account) {
            log.warn("No account selected for Antigravity")
            return null
        }

        // Check if token needs refresh (5 minute buffer)
        if (forceRefresh || account.expires < Date.now() + 5 * 60 * 1000) {
            if (forceRefresh) log.info("Forcing Antigravity token refresh", { email: account.email });
            log.info("Refreshing Antigravity token", { email: account.email })
            try {
                const refreshed = await refreshToken(account.refresh)
                account.access = refreshed.access
                account.expires = refreshed.expires
                // Update auth storage
                await Auth.set("google-antigravity", {
                    type: "oauth",
                    refresh: account.refresh,
                    access: account.access,
                    expires: account.expires,
                    accountId: account.email,
                })
                log.info("Antigravity token refreshed successfully")
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                log.error("Antigravity token refresh failed", { email: account.email, error: errorMessage })
                // Try next account on refresh failure
                if (state.accounts.length > 1) {
                    state.currentIndex = (state.currentIndex + 1) % state.accounts.length
                    return getAccessToken()
                }
                return null
            }
        }

        log.info("Using Antigravity token", { email: account.email, expires: new Date(account.expires).toISOString() })
        return account.access
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log.error("Error getting Antigravity access token", { error: errorMessage })
        return null
    }
}

/**
 * Create OAuth authorization URL with PKCE
 */
function createAuthUrl(pkce: PKCEPair, projectId: string): string {
    const url = new URL(GOOGLE_AUTH_URL)
    url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI)
    url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "))
    url.searchParams.set("code_challenge", pkce.challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", encodeState({ verifier: pkce.verifier, projectId }))
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")

    return url.toString()
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCode(
    code: string,
    state: string
): Promise<{ access: string; refresh: string; expires: number; email: string } | null> {
    try {
        const { verifier, projectId } = decodeState(state)

        const response = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: ANTIGRAVITY_CLIENT_ID,
                client_secret: ANTIGRAVITY_CLIENT_SECRET,
                code,
                grant_type: "authorization_code",
                redirect_uri: ANTIGRAVITY_REDIRECT_URI,
                code_verifier: verifier,
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            if (errorText.includes("restricted_client")) {
                log.error("Token exchange failed: restricted_client. This client ID might be restricted or disabled.")
                log.error("Token exchange failed: restricted_client. This client ID might be restricted or disabled.")
                // console.error calls removed to prevent TUI leak
            } else {
                log.error("Token exchange failed", {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                })
            }
            return null
        }

        const data = (await response.json()) as { access_token: string; expires_in: number; refresh_token: string }

        // Get user email
        let email = "unknown"
        try {
            const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
                headers: { Authorization: `Bearer ${data.access_token}` },
            })
            if (userInfoResponse.ok) {
                const userInfo = (await userInfoResponse.json()) as { email?: string }
                email = userInfo.email || "unknown"
            }
        } catch {
            // Ignore decode errors
        }

        // Store refresh token with project ID (format: token|projectId)
        const storedRefreshToken = `${data.refresh_token}|${projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID}`

        return {
            access: data.access_token,
            refresh: storedRefreshToken,
            expires: Date.now() + data.expires_in * 1000,
            email,
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log.error("Token exchange error", { error: errorMessage })
        return null
    }
}

/**
 * Start local OAuth callback server
 */
function startCallbackServer(port: number): Promise<{ code: string; state: string }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? "/", `http://localhost:${port}`)

            if (url.pathname === "/oauth2callback") {
                const code = url.searchParams.get("code")
                const state = url.searchParams.get("state")

                if (code && state) {
                    res.writeHead(200, { "Content-Type": "text/html" })
                    res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;">
                <div style="text-align: center;">
                  <h1>✅ Authentication Successful</h1>
                  <p>You can close this window and return to Navi.</p>
                </div>
              </body>
            </html>
          `)
                    server.close()
                    resolve({ code, state })
                } else {
                    res.writeHead(400, { "Content-Type": "text/html" })
                    res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;">
                <div style="text-align: center;">
                  <h1>❌ Authentication Failed</h1>
                  <p>Missing authorization code. Please try again.</p>
                </div>
              </body>
            </html>
          `)
                    server.close()
                    reject(new Error("Missing authorization code"))
                }
            } else {
                res.writeHead(404)
                res.end()
            }
        })

        server.listen(port)

        // Timeout after 5 minutes
        setTimeout(() => {
            server.close()
            reject(new Error("OAuth timeout"))
        }, 5 * 60 * 1000)
    })
}

/**
 * Map an antigravity model key to the actual API model name used by the Cloud Code PA endpoint.
 * Strips the "antigravity-" prefix since the API uses model names directly.
 */
function resolveAntigravityModelId(modelId: string): string {
    return modelId.startsWith("antigravity-") ? modelId.slice("antigravity-".length) : modelId
}

// ─── ANTIGRAVITY FETCH ───────────────────────────────────────────────────────

/**
 * Extract request body as string from various body types.
 */
function extractAntigravityBody(body: RequestInit["body"]): string {
    if (typeof body === "string") return body
    if (body instanceof URLSearchParams) return body.toString()
    if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8")
    if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer as ArrayBuffer).toString("utf8")
    return "{}"
}

/**
 * Parse a @ai-sdk/google URL to extract the model name and method.
 * Handles query params like ?alt=sse correctly.
 */
function parseAntigravityUrl(input: RequestInfo | URL): { rawModel: string; apiModel: string; method: string; isStream: boolean } | null {
    try {
        const urlStr = typeof input === "string" ? input
            : input instanceof URL ? input.toString()
                : (input as Request).url
        const u = new URL(urlStr)
        // Match pathname only (no query string)
        const match = u.pathname.match(/\/models\/([^:/?#]+):(generateContent|streamGenerateContent|countTokens)$/)
        if (!match) return null
        const rawModel = match[1]  // e.g. "antigravity-gemini-3-flash"
        // Strip the antigravity- prefix for the actual API model name
        const apiModel = rawModel.startsWith("antigravity-")
            ? rawModel.slice("antigravity-".length)
            : rawModel
        const method = match[2]
        return { rawModel, apiModel, method, isStream: method === "streamGenerateContent" }
    } catch {
        return null
    }
}

/**
 * Antigravity fetch: transforms @ai-sdk/google requests to Code Assist format.
 *
 * @ai-sdk/google sends:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}
 *   Body: { contents, systemInstruction, generationConfig, tools, ... }
 *
 * Code Assist (cloudcode-pa.googleapis.com) expects:
 *   POST https://cloudcode-pa.googleapis.com/v1internal:{method}
 *   Body: { model, project, user_prompt_id, request: { contents, systemInstruction, ... } }
 *
 * Response transformation (streaming):
 *   Code Assist SSE: data: { "response": <GenerateContentResponse> }
 *   @ai-sdk/google expects: data: <GenerateContentResponse>
 */
export async function antigravityFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const maxAttempts = 3

    const parsed = parseAntigravityUrl(input)
    if (!parsed) {
        // Not a model inference call — pass through with auth header only
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const token = await getAccessToken()
            if (!token) throw new Error("Unauthorized: No access token for Antigravity")
            const headers = new Headers(init?.headers || {})
            headers.set("Authorization", `Bearer ${token}`)
            headers.delete("x-goog-api-key")
            const response = await fetch(input, { ...init, headers })
            if (response.ok) return response
            if (response.status === 401 || response.status === 403) {
                if (attempt < maxAttempts) { await getAccessToken(true); continue }
            }
            return response
        }
        throw new Error("Antigravity: Pass-through request failed")
    }

    const { apiModel, method, isStream } = parsed

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const token = await getAccessToken()
        if (!token) throw new Error("Unauthorized: No access token available for Antigravity API")

        // Get project ID from stored refresh token (format: token|projectId)
        const auth = await Auth.get("google-antigravity") as any
        const storedRefresh: string = auth?.refresh ?? ""
        const parts = storedRefresh.split("|")
        const projectId = parts.length > 1 ? parts[1] : ""
        const effectiveProjectId = projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID

        // Parse and transform request body from @ai-sdk/google format to Code Assist format
        const rawBody = extractAntigravityBody(init?.body)
        const body = JSON.parse(rawBody || "{}") as Record<string, any>

        let codeAssistBody: Record<string, any>
        let endpoint: string

        if (method === "countTokens") {
            codeAssistBody = {
                request: {
                    model: `models/${apiModel}`,
                    contents: body.contents,
                },
            }
            endpoint = `${ANTIGRAVITY_BASE_URL}/${ANTIGRAVITY_API_VERSION}:countTokens`
        } else {
            codeAssistBody = {
                model: apiModel,
                project: effectiveProjectId,
                user_prompt_id: `navi-antigravity-${Date.now()}`,
                request: {
                    contents: body.contents || [],
                    systemInstruction: body.systemInstruction,
                    cachedContent: body.cachedContent,
                    tools: body.tools,
                    toolConfig: body.toolConfig,
                    labels: body.labels,
                    safetySettings: body.safetySettings,
                    generationConfig: body.generationConfig,
                },
            }
            endpoint = isStream
                ? `${ANTIGRAVITY_BASE_URL}/${ANTIGRAVITY_API_VERSION}:streamGenerateContent?alt=sse`
                : `${ANTIGRAVITY_BASE_URL}/${ANTIGRAVITY_API_VERSION}:generateContent`
        }

        log.info("Antigravity fetch", { model: apiModel, method, endpoint, attempt })

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(codeAssistBody),
        })

        if (!response.ok) {
            const errText = await response.clone().text().catch(() => "")
            log.error("Antigravity API error", {
                status: response.status,
                model: apiModel,
                error: errText.substring(0, 500),
            })

            if (response.status === 401 || response.status === 403) {
                if (attempt < maxAttempts) {
                    log.warn(`Antigravity: ${response.status}, refreshing token... (attempt ${attempt}/${maxAttempts})`)
                    await getAccessToken(true)
                    continue
                }
                return response
            }

            if (response.status === 429 || response.status >= 500) {
                if (attempt < maxAttempts) {
                    const delay = Math.pow(2, attempt) * 1000
                    log.warn(`Antigravity: ${response.status}, retrying in ${delay}ms... (attempt ${attempt}/${maxAttempts})`)
                    await new Promise(r => setTimeout(r, delay))
                    continue
                }
                return response
            }

            return response
        }

        // ── Transform response back to @ai-sdk/google format ───────────────────
        if (isStream) {
            // Code Assist SSE: data: { "response": <GenerateContentResponse> }
            // @ai-sdk/google expects: data: <GenerateContentResponse>
            const originalBody = response.body
            if (!originalBody) {
                return new Response(null, { status: response.status, statusText: response.statusText })
            }

            const transformedStream = new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    const text = new TextDecoder().decode(chunk)
                    const transformed = text
                        .split("\n")
                        .map((line) => {
                            if (!line.startsWith("data: ")) return line
                            const payload = line.slice(6)
                            if (payload.trim() === "[DONE]") return line
                            try {
                                const parsed = JSON.parse(payload) as { response?: unknown }
                                return `data: ${JSON.stringify(parsed.response ?? parsed)}`
                            } catch {
                                return line
                            }
                        })
                        .join("\n")
                    controller.enqueue(new TextEncoder().encode(transformed))
                },
            })

            originalBody.pipeTo(transformedStream.writable).catch((e) =>
                log.error("Antigravity: Stream pipe error", { error: String(e) })
            )

            return new Response(transformedStream.readable, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            })
        }

        if (method === "countTokens") {
            const data = await response.json().catch(() => undefined)
            return new Response(JSON.stringify(data), {
                status: response.status,
                statusText: response.statusText,
                headers: { "Content-Type": "application/json" },
            })
        }

        // generateContent: unwrap { response: {...} } -> {...}
        const data = (await response.json().catch(() => undefined)) as { response?: unknown } | undefined
        return new Response(JSON.stringify(data?.response ?? data ?? {}), {
            status: response.status,
            statusText: response.statusText,
            headers: { "Content-Type": "application/json" },
        })
    }

    throw new Error("Antigravity: Request failed after maximum retry attempts.")
}

/**
 * Antigravity Auth Hook for plugin integration
 */
export const AntigravityAuthHook: AuthHook = {
    provider: "google-antigravity",
    async loader(getAuth) {
        const auth = await getAuth()
        if (!auth || auth.type !== "oauth") {
            log.warn("No valid OAuth authentication found for Antigravity")
            return {}
        }

        // Check if token needs refresh (graceful — don't throw, just log)
        const authWithAccount = auth as typeof auth & { accountId?: string }
        if (auth.expires < Date.now() + 5 * 60 * 1000) {
            log.info("Refreshing token in loader", { email: authWithAccount.accountId })
            try {
                const refreshed = await refreshToken(auth.refresh)
                if (refreshed) {
                    await Auth.set("google-antigravity", {
                        type: "oauth",
                        refresh: auth.refresh,
                        access: refreshed.access,
                        expires: refreshed.expires,
                        accountId: authWithAccount.accountId,
                    })
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                // Don't throw — the token might still be valid or getAccessToken() will handle it
                log.warn("Pre-flight token refresh failed in loader, will retry on request", { email: authWithAccount.accountId, error: errorMessage })
            }
        }

        return {
            baseURL: ANTIGRAVITY_BASE_URL,
            fetch: antigravityFetch,
        }
    },
    methods: [
        {
            type: "oauth",
            label: "OAuth with Google (Antigravity)",
            prompts: [
                {
                    type: "text",
                    key: "projectId",
                    message: "Google Cloud Project ID (optional)",
                    placeholder: ANTIGRAVITY_DEFAULT_PROJECT_ID,
                },
            ],
            async authorize(inputs: Record<string, string> = {}): Promise<AuthOuathResult> {
                const port = 51121
                const pkce = generatePKCE()
                const projectId = inputs.projectId || ANTIGRAVITY_DEFAULT_PROJECT_ID
                const authUrl = createAuthUrl(pkce, projectId)

                // Log URL in case open fails
                // console.log(`\n\nLogin URL: ${authUrl}\n\n`) // Removed to prevent TUI leak
                log.info("Auth URL generated", { url: authUrl })

                // Start callback server
                const callbackPromise = startCallbackServer(port)

                // Open browser
                await open(authUrl)

                return {
                    url: authUrl,
                    instructions: "Complete sign-in in your browser. This window will update automatically.",
                    method: "auto",
                    async callback() {
                        try {
                            const { code, state: stateStr } = await callbackPromise
                            const { projectId } = decodeState(stateStr)
                            const tokens = await exchangeCode(code, stateStr)
                            if (!tokens) {
                                return { type: "failed" }
                            }

                            return {
                                type: "success",
                                provider: "google-antigravity",
                                // tokens.refresh already contains projectId (set in exchangeCode)
                                // Don't double-append it here
                                refresh: tokens.refresh,
                                access: tokens.access,
                                expires: tokens.expires,
                                accountId: tokens.email,
                            }
                        } catch {
                            return { type: "failed" }
                        }
                    },
                }
            },
        },
    ],
}

/**
 * Get Antigravity provider config for merging into main provider config
 */
export function getAntigravityProviderConfig() {
    return {
        id: "google-antigravity",
        name: "Google (Antigravity)",
        api: ANTIGRAVITY_BASE_URL,
        npm: "@ai-sdk/google",
        env: [],
        models: ANTIGRAVITY_MODELS,
    }
}

export async function AntigravityAuthPlugin(_input: PluginInput): Promise<Hooks> {
    return {
        auth: AntigravityAuthHook
    }
}

export default AntigravityAuthPlugin


