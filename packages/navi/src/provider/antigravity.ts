/**
 * Antigravity OAuth Provider for Navi
 *
 * Provides Google OAuth authentication for accessing Google's Antigravity IDE
 * which grants access to advanced Gemini and Claude models with higher quotas.
 *
 * Based on opencode-antigravity-auth by NoeFabris
 * @see https://github.com/NoeFabris/opencode-antigravity-auth
 */

import type { Hooks, AuthHook, AuthOuathResult, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import { Log } from "../util/log"
import http from "http"
import open from "open"
import { URL } from "url"
import crypto from "crypto"

const log = Log.create({ service: "antigravity" })

// Antigravity OAuth configuration (from  opencode-antigravity-auth)
const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
const ANTIGRAVITY_CLIENT_SECRET = "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"
const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback"
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

// OAuth Scopes for Antigravity (including cclog and experimentsandconfigs)
const ANTIGRAVITY_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
]

// Antigravity API configuration
const ANTIGRAVITY_BASE_URL = "https://daily-cloudcode-pa.sandbox.googleapis.com"
const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc"

/**
 * Antigravity model definitions
 */
export const ANTIGRAVITY_MODELS = {
    "antigravity-gemini-3-pro": {
        name: "Gemini 3 Pro (Antigravity)",
        id: "gemini-3-pro",
        thinking: true,
        attachment: true,
        limit: { context: 1048576, output: 65535 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    "antigravity-gemini-3-flash": {
        name: "Gemini 3 Flash (Antigravity)",
        id: "gemini-3-flash",
        attachment: true,
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
    },
    "antigravity-claude-4-5-sonnet": {
        name: "Claude 4.5 Sonnet (Antigravity)",
        id: "claude-4-5-sonnet",
        thinking: true,
        attachment: true,
        limit: { context: 200000, output: 64000 },
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
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
    const auths = await Auth.list("google-antigravity")
    const accounts: AntigravityAccount[] = []

    for (const auth of auths) {
        if (auth.type === "oauth") {
            const accountId = (auth as typeof auth & { accountId?: string }).accountId
            accounts.push({
                email: accountId || "unknown",
                refresh: auth.refresh,
                access: auth.access,
                expires: auth.expires,
            })
        }
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
            log.error("Token exchange failed", {
                status: response.status,
                statusText: response.statusText,
                error: errorText
            })
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

            if (url.pathname === "/oauth-callback") {
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

        // Check if token needs refresh
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
                log.error("Failed to refresh token in loader", { email: authWithAccount.accountId, error: errorMessage })
                throw new Error(`Failed to refresh Antigravity token in loader: ${errorMessage}`)
            }
        }

        return {
            // Don't set apiKey - we'll use Authorization header via custom fetch
            baseURL: ANTIGRAVITY_BASE_URL,
            // Use custom fetch to add Authorization header dynamically
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                const token = await getAccessToken()
                if (!token) {
                    log.error("No access token available for Antigravity request")
                    throw new Error("Unauthorized: No access token available for Antigravity API")
                }

                const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
                log.info("Antigravity fetch", { url, hasToken: !!token })

                const headers = new Headers(init?.headers || {})
                headers.set("Authorization", `Bearer ${token}`)
                headers.delete("x-goog-api-key") // Remove any API key header

                const response = await fetch(input, {
                    ...init,
                    headers,
                })

                // If unauthorized, try refreshing token and retry once
                if (response.status === 401) {
                    log.warn("Received 401, forcing token refresh and retrying...")
                    const newToken = await getAccessToken(true)
                    if (newToken) {
                        headers.set("Authorization", `Bearer ${newToken}`)
                        return fetch(input, {
                            ...init,
                            headers,
                        })
                    }
                }

                return response
            },
        }
    },
    methods: [
        {
            type: "oauth",
            label: "OAuth with Google (Antigravity)",
            async authorize(): Promise<AuthOuathResult> {
                const port = 51121
                const pkce = generatePKCE()
                const projectId = "" // Will be fetched during token exchange if not provided
                const authUrl = createAuthUrl(pkce, projectId)

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
                            const { code, state } = await callbackPromise

                            const tokens = await exchangeCode(code, state)
                            if (!tokens) {
                                return { type: "failed" }
                            }

                            return {
                                type: "success",
                                provider: "google-antigravity",
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
