/**
 * Qwen CLI OAuth Provider for Navi
 *
 * Provides Qwen OAuth authentication for accessing Qwen models using Device Flow.
 */

import type { Hooks, AuthHook, AuthOuathResult, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import { Log } from "../util/log"
import { Env } from "../env"
import crypto from "crypto"
import open from "open"
import { readFile } from "fs/promises"
import { homedir } from "os"
import { join } from "path"


const log = Log.create({ service: "qwen-cli" })

// Qwen OAuth Configuration
const getQwenClientID = () => Env.get("QWEN_CLIENT_ID") || "f0304373b74a44d2b584a3fb70ca9e56"
const QWEN_SCOPES = "openid profile email model.completion"
const QWEN_BASE_URL = "https://chat.qwen.ai"
const QWEN_DEVICE_CODE_URL = `${QWEN_BASE_URL}/api/v1/oauth2/device/code`
const QWEN_TOKEN_URL = `${QWEN_BASE_URL}/api/v1/oauth2/token`

// API Configuration
// Default endpoint. OAuth responses can provide a provider-specific resource_url
// that should be preferred at runtime.
// For Qwen OAuth, we prefer the portal endpoint as it supports coder-model.
export const QWEN_API_URL = "https://portal.qwen.ai/v1"

/**
 * Qwen model definitions.
 * When using OAuth (portal.qwen.ai/v1), only 'coder-model' is supported.
 * This is the Qwen 3.6 Plus model — efficient hybrid with leading coding performance.
 */
export const QWEN_MODELS = {
    "coder-model": {
        name: "Qwen (coder-model)",
        id: "coder-model",
        limit: { context: 131072, output: 8192 },
    },
} as const

function generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString("base64url")
}

function generateCodeChallenge(codeVerifier: string): string {
    const hash = crypto.createHash("sha256")
    hash.update(codeVerifier)
    return hash.digest("base64url")
}

async function requestDeviceCode(verifier: string) {
    const challenge = generateCodeChallenge(verifier)
    const response = await fetch(QWEN_DEVICE_CODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: getQwenClientID(),
            scope: QWEN_SCOPES,
            code_challenge: challenge,
            code_challenge_method: "S256",
            // Add request ID for tracking
            x_request_id: crypto.randomUUID(),
        }),
    })

    if (!response.ok) throw new Error(`Device code request failed: ${await response.text()}`)
    return (await response.json()) as {
        device_code: string
        user_code: string
        verification_uri: string
        verification_uri_complete: string
        expires_in: number
        interval: number
    }
}

async function pollForToken(
    deviceCode: string,
    verifier: string,
    interval: number,
    expiresIn: number,
): Promise<{ access: string; refresh: string; expires: number; resourceUrl?: string } | null> {
    const endTime = Date.now() + expiresIn * 1000
    let currentInterval = interval * 1000

    while (Date.now() < endTime) {
        await new Promise(r => setTimeout(r, currentInterval))

        try {
            const response = await fetch(QWEN_TOKEN_URL, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    client_id: getQwenClientID(),
                    device_code: deviceCode,
                    code_verifier: verifier,
                }),
            })

            if (response.ok) {
                const data = await response.json()
                return {
                    access: data.access_token,
                    refresh: data.refresh_token,
                    expires: Date.now() + data.expires_in * 1000,
                    resourceUrl: data.resource_url,
                }
            }

            const errorData = await response.json()
            if (errorData.error === "slow_down") {
                currentInterval += 5000 // Increase interval more significantly
            } else if (errorData.error !== "authorization_pending") {
                throw new Error(errorData.error)
            }
        } catch (e) {
            log.warn("Polling error", { error: String(e) })
        }
    }
    return null
}

async function refreshToken(refreshToken: string): Promise<{ access: string; expires: number; resourceUrl?: string }> {
    try {
        const response = await fetch(QWEN_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: getQwenClientID(),
                refresh_token: refreshToken,
            }),
        })

        if (!response.ok) {
            // If refresh fails (e.g. invalid grant), we might need to re-login
            throw new Error(`Token refresh failed: ${await response.text()}`)
        }

        const data = await response.json()
        return {
            access: data.access_token,
            expires: Date.now() + data.expires_in * 1000,
            resourceUrl: data.resource_url,
        }
    } catch (error) {
        log.error("Token refresh error", { error: String(error) })
        throw error
    }
}

/**
 * Get a valid access token, refreshing if needed
 */
/**
 * Normalizes the Qwen API base URL.
 * portal.qwen.ai uses /v1
 * dashscope.aliyuncs.com uses /compatible-mode/v1
 */
function normalizeBaseURL(resourceUrl?: string): string {
    const base = resourceUrl && resourceUrl.trim().length > 0 ? resourceUrl : QWEN_API_URL
    const withProtocol = /^https?:\/\//.test(base) ? base : `https://${base}`
    let cleaned = withProtocol.replace(/\/+$/, "")
    
    // Direct mapping for known hosts to ensure correct paths
    if (cleaned.includes("portal.qwen.ai")) {
        return cleaned.endsWith("/v1") ? cleaned : `${cleaned}/v1`
    }
    
    if (cleaned.includes("dashscope.aliyuncs.com")) {
        if (cleaned.includes("/compatible-mode")) return cleaned
        return `${cleaned}/compatible-mode/v1`
    }

    // Default to /v1 for OpenAI-compatible behavior
    if (cleaned.endsWith("/v1") || cleaned.includes("/v1/")) {
        return cleaned
    }
    return `${cleaned}/v1`
}

/**
 * Try to read qwen-code's own credential file (~/.qwen/oauth_creds.json).
 * This is the authoritative source for Qwen OAuth tokens — the VSCode extension
 * stores working tokens there which are accepted by portal.qwen.ai.
 */
async function readQwenCodeCredentials(): Promise<{ token: string; baseURL: string } | null> {
    try {
        const filePath = join(homedir(), ".qwen", "oauth_creds.json")
        const raw = await readFile(filePath, "utf-8")
        const creds = JSON.parse(raw)
        if (!creds.access_token) return null
        // Check not expired (expiry_date is in ms)
        if (creds.expiry_date && Date.now() > creds.expiry_date - 5 * 60 * 1000) {
            log.info("qwen-code credentials expired, falling back to Navi auth")
            return null
        }
        const baseURL = normalizeBaseURL(creds.resource_url)
        log.info("Using qwen-code credentials from ~/.qwen/oauth_creds.json", { baseURL })
        return { token: creds.access_token, baseURL }
    } catch {
        return null
    }
}

export async function getAccessCredentials(
    forceRefresh = false,
): Promise<{ token: string; baseURL: string } | null> {
    try {
        // Priority 1: qwen-code's own credential file (~/.qwen/oauth_creds.json)
        // These tokens are known to work with portal.qwen.ai/v1
        if (!forceRefresh) {
            const qwenCodeCreds = await readQwenCodeCredentials()
            if (qwenCodeCreds) return qwenCodeCreds
        }

        // Priority 2: Navi's own auth store
        const auth = await Auth.get("qwen-cli")
        if (!auth || auth.type !== "oauth") {
            log.info("No Navi auth found for qwen-cli")
            return null
        }
        log.info("Using Navi auth for qwen-cli")

        const shouldRefresh =
            forceRefresh ||
            auth.expires < Date.now() + 5 * 60 * 1000 ||
            !auth.resourceUrl

        if (shouldRefresh) {
            try {
                const refreshed = await refreshToken(auth.refresh)
                await Auth.set("qwen-cli", {
                    ...auth,
                    access: refreshed.access,
                    expires: refreshed.expires,
                    resourceUrl: refreshed.resourceUrl ?? auth.resourceUrl,
                })
                return {
                    token: refreshed.access,
                    baseURL: normalizeBaseURL(refreshed.resourceUrl ?? auth.resourceUrl),
                }
            } catch (e) {
                log.error("Failed to refresh token", { error: String(e) })
                return null
            }
        }

        return {
            token: auth.access,
            baseURL: normalizeBaseURL(auth.resourceUrl),
        }
    } catch (error) {
        log.error("Error getting Qwen access token", { error: String(error) })
        return null
    }
}

export async function getAccessToken(forceRefresh = false): Promise<string | null> {
    const creds = await getAccessCredentials(forceRefresh)
    return creds?.token ?? null
}

export const QwenAuthHook: AuthHook = {
    provider: "qwen-cli",
    async loader(_getAuth) {
        // Dynamically resolve baseURL from stored credentials
        const initialCreds = await getAccessCredentials()
        const resolvedBaseURL = initialCreds?.baseURL ?? QWEN_API_URL
        return {
            baseURL: resolvedBaseURL,
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                const creds = await getAccessCredentials()
                if (!creds) throw new Error("Unauthorized")

                const headers = new Headers(init?.headers)
                headers.set("Authorization", `Bearer ${creds.token}`)
                // portal.qwen.ai doesn't need DashScope-specific headers
                // Only add them when hitting dashscope.aliyuncs.com
                if (creds.baseURL.includes("dashscope")) {
                    headers.set("X-DashScope-AuthType", "qwen-oauth")
                    headers.set("X-DashScope-CacheControl", "enable")
                    headers.set("X-DashScope-UserAgent", "qwen-vscode/1.1.0")
                    headers.set("X-DashScope-ApiKey", creds.token)
                }
                headers.set("User-Agent", "qwen-vscode/1.1.0")

                const rawURL = typeof input === "string" ? input : input.toString()
                const normalizedBase = QWEN_API_URL.replace(/\/$/, "")
                const normalizedCredsBase = creds.baseURL.replace(/\/$/, "")
                const requestURL = rawURL.startsWith(normalizedBase)
                    ? rawURL.replace(normalizedBase, normalizedCredsBase)
                    : rawURL

                if (init?.body) {
                    try {
                        // DIAGNOSTIC: Extreme pruning to identify cause of 400
                        const body = JSON.parse(init.body as string)
                        const allowedKeys = ["model", "messages", "stream"]
                        Object.keys(body).forEach(key => {
                            if (!allowedKeys.includes(key)) delete body[key]
                        })
                        
                        // Log for debugging
                        const logHeaders = Object.fromEntries(headers.entries())
                        if (logHeaders["authorization"]) {
                            logHeaders["authorization"] = logHeaders["authorization"].substring(0, 15) + "..."
                        }
                        
                        console.log("\x1b[35m[Qwen DIAGNOSTIC]\x1b[0m Request:", { 
                            url: requestURL, 
                            headers: logHeaders,
                            model: body.model,
                            bodyKeys: Object.keys(body)
                        })
                        
                        init.body = JSON.stringify(body)
                    } catch (e) {
                        console.warn("Failed to parse/prune request body", e)
                    }
                }
                let response = await fetch(requestURL, { ...init, headers }) 
                if (!response.ok) {
                    const errorJson = await response.clone().json().catch(() => ({}))
                    console.log("\x1b[31m[Qwen API] Error:\x1b[0m", {
                        status: response.status,
                        error: errorJson
                    })
                }
                console.log("DashScope Response Status:", response.status)

                if (!response.ok) {
                    const text = await response.clone().text()
                    log.error("DashScope Error Response", { status: response.status, body: text })
                    console.log("DashScope Error Body:", text)
                }

                if (response.status === 401) {
                    log.info("Received 401, attempting to refresh token...")
                    const refreshed = await getAccessCredentials(true)
                    if (refreshed) {
                        log.info("Token refreshed, retrying request...")
                        headers.set("Authorization", `Bearer ${refreshed.token}`)
                        const retryURL = requestURL.startsWith(creds.baseURL)
                            ? requestURL.replace(creds.baseURL, refreshed.baseURL)
                            : requestURL
                        response = await fetch(retryURL, { ...init, headers })
                    }
                }
                return response
            }
        }
    },
    methods: [
        {
            type: "oauth",
            label: "Login with Qwen (Device Flow)",
            async authorize(inputs: Record<string, string> = {}): Promise<AuthOuathResult> {
                const verifier = generateCodeVerifier()
                const codeData = await requestDeviceCode(verifier)
                const authUrl = codeData.verification_uri_complete || codeData.verification_uri

                // Automatically open the browser
                try {
                    await open(authUrl)
                } catch (e) {
                    log.warn("Could not open browser", { error: String(e) })
                }

                return {
                    url: authUrl,
                    instructions: `Your code: ${codeData.user_code} (entered automatically if browser opened)`,
                    method: "auto",
                    async callback() {
                        const tokens = await pollForToken(
                            codeData.device_code,
                            verifier,
                            codeData.interval || 5,
                            codeData.expires_in
                        )

                        if (!tokens) return { type: "failed" }

                        return {
                            type: "success",
                            provider: "qwen-cli",
                            refresh: tokens.refresh,
                            access: tokens.access,
                            expires: tokens.expires,
                            resourceUrl: tokens.resourceUrl,
                            accountId: "qwen-user", // We don't get email from token endpoint usually
                        }
                    }
                }
            }
        }
    ]
}

export async function QwenAuthPlugin(_input: PluginInput): Promise<Hooks> {
    return { auth: QwenAuthHook }
}


