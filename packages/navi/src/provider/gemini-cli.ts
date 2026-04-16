/**
 * Gemini CLI OAuth Provider for Navi
 *
 * Provides Google OAuth authentication for accessing Gemini CLI models
 * via the Code Assist endpoint (cloudcode-pa.googleapis.com).
 *
 * Architecture:
 * - Uses @ai-sdk/google as the SDK (sends to generativelanguage.googleapis.com)
 * - The custom fetch function intercepts all requests and:
 *   1. Transforms the request body to Code Assist format
 *   2. Routes to cloudcode-pa.googleapis.com instead
 *   3. Transforms the response back to generativelanguage format
 * - Falls back to direct generativelanguage.googleapis.com if Code Assist fails
 */

import type { Hooks, AuthHook, AuthOAuthResult, PluginInput } from "@/plugin"
import { Auth } from "../auth"
import { Log } from "../util/log"
import http from "http"
import net from "net"
import open from "open"
import crypto from "crypto"
import { OAuth2Client } from "google-auth-library"

import os from "os"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "gemini-cli" })

// Gemini CLI OAuth configuration — same as official gemini-cli
const GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const GEMINI_CLIENT_SECRET = "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"
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"
let cachedProjectId: string | undefined

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
let lastValidatedToken: string | null = null
let lastValidatedTokenHasScope = false
let skipGeminiCliFileMigration = false

// NOTE: Only cloud-platform is authorized for the Gemini CLI OAuth client ID.
// The generative-language scope is NOT registered for this client.
export const GEMINI_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
]


// @ai-sdk/google sends to this base URL
export const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta"

/**
 * Gemini model definitions
 */
export const GEMINI_MODELS = {
    "gemini-3.1-pro-preview": {
        name: "Gemini 3.1 Pro Preview",
        id: "gemini-3.1-pro-preview",
        thinking: true,
        limit: { context: 1048576, output: 65535 },
    },
    "gemini-3-pro-preview": {
        name: "Gemini 3 Pro Preview",
        id: "gemini-3-pro-preview",
        thinking: true,
        limit: { context: 1048576, output: 65535 },
    },
    "gemini-3-flash-preview": {
        name: "Gemini 3 Flash Preview",
        id: "gemini-3-flash-preview",
        thinking: false,
        limit: { context: 1048576, output: 65535 },
    },
    "gemini-2.5-pro": {
        name: "Gemini 2.5 Pro",
        id: "gemini-2.5-pro",
        thinking: true,
        limit: { context: 1048576, output: 65535 },
    },
    "gemini-2.5-flash": {
        name: "Gemini 2.5 Flash",
        id: "gemini-2.5-flash",
        thinking: false,
        limit: { context: 1048576, output: 65535 },
    },
    "gemini-2.5-flash-lite": {
        name: "Gemini 2.5 Flash Lite",
        id: "gemini-2.5-flash-lite",
        thinking: false,
        limit: { context: 1048576, output: 65535 },
    },
} as const

const GEMINI_MODEL_ALIASES: Record<string, string> = {
    "gemini-3-pro": "gemini-3-pro-preview",
    "gemini-3-flash": "gemini-3-flash-preview",
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
}

export function resolveGeminiModelID(modelID: string): string {
    return GEMINI_MODEL_ALIASES[modelID] ?? modelID
}

// ─── STATE ───────────────────────────────────────────────────────────────────

function generateOAuthState(): string {
    return crypto.randomBytes(32).toString("hex")
}


// ─── TOKEN REFRESH ───────────────────────────────────────────────────────────

async function refreshAccessTokenImpl(refreshTokenStr: string): Promise<{ access: string; expires: number }> {
    const client = new OAuth2Client({
        clientId: GEMINI_CLIENT_ID,
        clientSecret: GEMINI_CLIENT_SECRET,
    })
    client.setCredentials({ refresh_token: refreshTokenStr })
    const { token } = await client.getAccessToken()
    if (!token) throw new Error("Token refresh failed: no token returned")
    return {
        access: token,
        expires: Date.now() + 3500 * 1000,
    }
}

async function ensureRequiredScopes(token: string): Promise<boolean> {
    if (token === lastValidatedToken) return lastValidatedTokenHasScope

    const client = new OAuth2Client({
        clientId: GEMINI_CLIENT_ID,
        clientSecret: GEMINI_CLIENT_SECRET,
    })

    try {
        const info = await client.getTokenInfo(token)
        const infoScopes = (info as { scopes?: string[]; scope?: string }).scopes
        const legacyScope = (info as { scope?: string }).scope
        const scopes = Array.isArray(infoScopes)
            ? infoScopes
            : typeof legacyScope === "string"
                ? legacyScope.split(" ")
                : []

        log.info("Gemini CLI: Token scopes retrieved", { scopes })

        // Relaxed check: as long as it has ONE of our required scopes, it might work
        // (official tool uses all three, but sometimes only one is returned in token info)
        const hasScope = GEMINI_SCOPES.some(s => scopes.includes(s))
        
        if (!hasScope) {
            log.warn("Gemini CLI: Token is missing ALL required scopes", {
                expectedOneOf: GEMINI_SCOPES,
                found: scopes
            })
        }

        lastValidatedToken = token
        lastValidatedTokenHasScope = hasScope
        return hasScope
    } catch (error) {
        log.warn("Gemini CLI: Failed to validate token scopes", { error: String(error) })
        lastValidatedToken = token
        lastValidatedTokenHasScope = false
        return true // Fallback to true to avoid immediate removal on network error
    }
}


// ─── AUTH STORAGE ────────────────────────────────────────────────────────────

async function getGeminiAuth() {
    // First try Navi's auth storage
    const auth = await Auth.get("gemini-cli")
    if (auth && auth.type === "oauth") {
        log.info("Gemini CLI: Found credentials in Navi storage")
        return auth
    }

    // Migrate from official gemini-cli's credentials file
    if (skipGeminiCliFileMigration) return null

    try {
        const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json")
        log.info("Gemini CLI: Attempting to migrate from", { path: credsPath })
        const credsContent = await fs.readFile(credsPath, "utf8")
        const creds = JSON.parse(credsContent)

        if (creds.access_token && creds.refresh_token) {
            log.info("Gemini CLI: Found valid credentials in official file")
            const fallbackAuth: Auth.Info = {
                type: "oauth",
                access: creds.access_token,
                refresh: creds.refresh_token,
                expires: creds.expiry_date ? Number(creds.expiry_date) : Date.now() + 3500 * 1000,
                accountId: creds.email || "migrated-user",
            }

            const hasScope = await ensureRequiredScopes(fallbackAuth.access)
            if (!hasScope) {
                log.warn("Gemini CLI: Migrated credentials missing required scopes")
                // Don't skip migration entirely yet, maybe the user can re-auth
                return null
            }

            await Auth.set("gemini-cli", fallbackAuth).catch((e) => log.error("Gemini CLI: Failed to save migrated auth", { error: String(e) }))
            return fallbackAuth
        }
    } catch (e: any) {
        log.info("Gemini CLI: Official credentials file not found or unreadable", { error: e?.code })
    }


    return null
}

export async function getAccessToken(forceRefresh = false): Promise<string | null> {
    try {
        const auth = await getGeminiAuth()
        if (!auth || auth.type !== "oauth") {
            log.info("Gemini CLI: No auth found in getAccessToken")
            return null
        }

        if (forceRefresh || auth.expires < Date.now() + 5 * 60 * 1000) {
            log.info("Gemini CLI: Refreshing access token...")
            try {
                const refreshed = await refreshAccessTokenImpl(auth.refresh)
                await Auth.set("gemini-cli", {
                    ...auth,
                    access: refreshed.access,
                    expires: refreshed.expires,
                })
                log.info("Gemini CLI: Token refreshed.")
                return refreshed.access
            } catch (e) {
                log.error("Gemini CLI: Token refresh failed", { error: String(e) })
                log.info("Gemini CLI: Attempting to use existing token as fallback")
                return auth.access
            }
        }

        return auth.access

    } catch (error) {
        log.error("Gemini CLI: Failed to get access token", { error: String(error) })
        return null
    }
}

// ─── CODE ASSIST PROJECT ID ──────────────────────────────────────────────────

async function getGeminiCliProjectId(token: string): Promise<string | undefined> {
    if (cachedProjectId) return cachedProjectId

    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            cloudaicompanionProject: undefined,
            metadata: {
                ideType: "IDE_UNSPECIFIED",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI",
                duetProject: undefined,
            },
        }),
    })

    if (response.status === 401) throw new Error("TOKEN_EXPIRED")

    if (!response.ok) {
        log.warn("Gemini CLI: loadCodeAssist failed", { status: response.status })
        return undefined
    }

    const data = (await response.json()) as { cloudaicompanionProject?: string }
    const projectId = data.cloudaicompanionProject
    if (projectId) cachedProjectId = projectId
    return projectId
}

// ─── REQUEST BODY PARSING ─────────────────────────────────────────────────────

function extractRequestBody(body: RequestInit["body"]): string {
    if (typeof body === "string") return body
    if (body instanceof URLSearchParams) return body.toString()
    if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8")
    if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer as ArrayBuffer).toString("utf8")
    return "{}"
}

const SYNTHETIC_THOUGHT_SIGNATURE = "skip_thought_signature_validator"

// ─── URL PARSING ──────────────────────────────────────────────────────────────

/**
 * Parses the URL from @ai-sdk/google to extract model name and method.
 *
 * @ai-sdk/google sends to:
 *   https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}
 *   https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}?alt=sse
 *
 * We need to match the pathname ignoring query params.
 */
function parseGoogleAIUrl(input: RequestInfo | URL): { model: string; method: string } | null {
    try {
        const urlStr = typeof input === "string" ? input
            : input instanceof URL ? input.toString()
                : (input as Request).url
        // Parse URL to get pathname without query string
        const u = new URL(urlStr)
        const pathname = u.pathname
        // Match: /v1beta/models/{model}:{method} or /models/{model}:{method}
        const match = pathname.match(/\/models\/([^:/?#]+):(generateContent|streamGenerateContent|countTokens)$/)
        if (!match) return null
        return {
            model: match[1].replace(/^models\//, ""),
            method: match[2] as "generateContent" | "streamGenerateContent" | "countTokens",
        }
    } catch {
        return null
    }
}

// ─── REQUEST TRANSFORMATION ───────────────────────────────────────────────────

function toPart(part: any): any {
    if (typeof part === "string") return { text: part }

    if ("thought" in part && part.thought) {
        const thoughtText = `[Thought: ${part.thought}]`
        const newPart = { ...part }
        delete newPart.thought

        const hasApiContent =
            "functionCall" in newPart ||
            "functionResponse" in newPart ||
            "inlineData" in newPart ||
            "fileData" in newPart

        if (hasApiContent) return newPart

        const text = newPart.text
        const existingText = text ? String(text) : ""
        newPart.text = existingText ? `${existingText}\n${thoughtText}` : thoughtText
        return newPart
    }

    return part
}

function toParts(parts: any[]): any[] {
    return parts.map(toPart)
}

function toContent(content: any): any {
    if (typeof content === "string") {
        return { role: "user", parts: [{ text: content }] }
    }
    if (Array.isArray(content)) {
        return { role: "user", parts: toParts(content) }
    }
    if (content && typeof content === "object" && !("parts" in content)) {
        // It's a single part
        return { role: "user", parts: [toPart(content)] }
    }
    if (content && content.parts) {
        return {
            ...content,
            parts: toParts(content.parts.filter((p: any) => p != null)),
        }
    }
    return content
}

function toContents(contents: any): any[] {
    if (Array.isArray(contents)) {
        return contents.map(toContent)
    }
    return [toContent(contents)]
}

// ─── CODE ASSIST CALL ────────────────────────────────────────────────────────

/**
 * Transforms a @ai-sdk/google request into a Code Assist request and sends it.
 * Returns null if this URL is not a model inference call or if Code Assist
 * project ID is unavailable (so the caller can fall back to direct API).
 */
async function callCodeAssist(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    token: string,
): Promise<Response | null> {
    const parsed = parseGoogleAIUrl(input)
    if (!parsed) return null

    const { model, method } = parsed
    const rawBody = extractRequestBody(init?.body)
    const body = JSON.parse(rawBody || "{}") as Record<string, any>

    // Transform contents and systemInstruction using official gemini-cli logic
    const contents = toContents(body.contents || [])
    const systemInstruction = body.systemInstruction ? toContent(body.systemInstruction) : undefined

    // Inject thoughtSignature for Gemini 3 function calls (required by Code Assist)
    for (const content of contents) {
        if (content.parts && Array.isArray(content.parts)) {
            for (const part of content.parts) {
                if (part.functionCall && !part.thoughtSignature) {
                    part.thoughtSignature = SYNTHETIC_THOUGHT_SIGNATURE
                }
            }
        }
    }

    const projectId = await getGeminiCliProjectId(token).catch((e) => {
        if (e?.message === "TOKEN_EXPIRED") throw e
        return undefined
    })

    if (!projectId) {
        log.warn("Gemini CLI: No Code Assist project ID found")
        throw new Error("NO_CODE_ASSIST_PROJECT")
    }


    const userPromptId = `navi-${Date.now()}`

    let codeAssistBody: Record<string, any>
    let endpoint: string

    if (method === "countTokens") {
        codeAssistBody = {
            request: {
                model: `models/${model}`,
                contents: contents,
            },
        }
        endpoint = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:countTokens`
    } else if (method === "streamGenerateContent") {
        codeAssistBody = {
            model: model,
            project: projectId,
            user_prompt_id: userPromptId,
            request: {
                contents: contents,
                systemInstruction: systemInstruction,
                cachedContent: body.cachedContent,
                tools: body.tools,
                toolConfig: body.toolConfig,
                labels: body.labels,
                safetySettings: body.safetySettings,
                generationConfig: body.generationConfig,
            },
        }
        endpoint = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`
    } else {
        // generateContent
        codeAssistBody = {
            model: model,
            project: projectId,
            user_prompt_id: userPromptId,
            request: {
                contents: contents,
                systemInstruction: systemInstruction,
                cachedContent: body.cachedContent,
                tools: body.tools,
                toolConfig: body.toolConfig,
                labels: body.labels,
                safetySettings: body.safetySettings,
                generationConfig: body.generationConfig,
            },
        }
        endpoint = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`
    }

    try {
        // Merge headers from init.headers to preserve User-Agent etc.
        const headers = new Headers(init?.headers)
        headers.set("Content-Type", "application/json")
        headers.set("Authorization", `Bearer ${token}`)
        // Set User-Agent to match official gemini-cli — some servers might require this
        headers.set("User-Agent", `GeminiCLI/0.1.8/${model} (${os.platform()}; ${os.arch()})`)
        // Remove API key if present
        headers.delete("x-goog-api-key")

        const caResponse = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(codeAssistBody),
        })

        if (!caResponse.ok) {
            const errorText = await caResponse.text().catch(() => "unknown")
            log.error("Gemini CLI: Code Assist API failed", {
                status: caResponse.status,
                method,
                error: errorText.substring(0, 500),
            })

            if (caResponse.status === 403) {
                try {
                    const errorData = JSON.parse(errorText)
                    if (
                        errorData.error?.message?.includes("insufficient authentication scopes")
                    ) {
                        throw new Error("INSUFFICIENT_SCOPES")
                    }
                    // Note: We do NOT throw for generic PERMISSION_DENIED anymore, 
                    // as it could be "API not enabled" or "User location not supported".
                    // We let it fall through so the user sees the real error.
                } catch (e) {
                    if (e instanceof Error && e.message === "INSUFFICIENT_SCOPES") throw e
                }
            }

            // Return the response (even if error) so the caller can handle it 
            // (e.g. retry on 429, or show error to user).
            // We do NOT return null anymore, as fallback to Direct API is impossible 
            // with the restricted Gemini CLI token.
            // We construct a new Response because we consumed the body text above.
            return new Response(errorText, {
                status: caResponse.status,
                statusText: caResponse.statusText,
                headers: caResponse.headers,
            })
        }

        // ── Transform response back to Google AI format ───────────────────────
        if (method === "streamGenerateContent") {
            // Code Assist SSE chunks are: data: { "response": <GenerateContentResponse> }
            // @ai-sdk/google expects:     data: <GenerateContentResponse>
            const originalBody = caResponse.body
            if (!originalBody) {
                return new Response(null, {
                    status: caResponse.status,
                    statusText: caResponse.statusText,
                })
            }

            // Use a buffer to handle fragmented SSE chunks
            let buffer = ""
            const transformedStream = new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    buffer += new TextDecoder().decode(chunk, { stream: true })
                    const lines = buffer.split("\n")
                    // Keep the last partial line in the buffer
                    buffer = lines.pop() || ""

                    const transformed = lines
                        .map((line) => {
                            if (!line.startsWith("data: ")) return line
                            const payload = line.slice(6)
                            if (payload.trim() === "[DONE]") return line
                            try {
                                const parsed = JSON.parse(payload) as { response?: unknown }
                                // Unwrap { response: {...} } -> {...}
                                return `data: ${JSON.stringify(parsed.response ?? parsed)}`
                            } catch {
                                return line
                            }
                        })
                        .join("\n")

                    if (transformed.length > 0 || lines.length > 0) {
                        controller.enqueue(new TextEncoder().encode(transformed + (lines.length > 0 ? "\n" : "")))
                    }
                },
                flush(controller) {
                    if (buffer.length > 0) {
                        let line = buffer
                        if (line.startsWith("data: ")) {
                            const payload = line.slice(6)
                            try {
                                const parsed = JSON.parse(payload) as { response?: unknown }
                                line = `data: ${JSON.stringify(parsed.response ?? parsed)}`
                            } catch { }
                        }
                        controller.enqueue(new TextEncoder().encode(line))
                    }
                }
            })

            originalBody.pipeTo(transformedStream.writable).catch((e) =>
                log.error("Gemini CLI: Stream pipe error", { error: String(e) })
            )

            return new Response(transformedStream.readable, {
                status: caResponse.status,
                statusText: caResponse.statusText,
                headers: caResponse.headers,
            })
        }

        if (method === "countTokens") {
            const data = await caResponse.json().catch(() => undefined)
            return new Response(JSON.stringify(data), {
                status: caResponse.status,
                statusText: caResponse.statusText,
                headers: { "Content-Type": "application/json" },
            })
        }

        // generateContent: unwrap { response: {...} } -> {...}
        const data = (await caResponse.json().catch(() => undefined)) as { response?: unknown } | undefined
        return new Response(JSON.stringify(data?.response ?? data ?? {}), {
            status: caResponse.status,
            statusText: caResponse.statusText,
            headers: { "Content-Type": "application/json" },
        })
    } catch (e) {
        if (e instanceof Error && (e.message === "TOKEN_EXPIRED" || e.message === "INSUFFICIENT_SCOPES")) {
            throw e
        }
        log.error("Gemini CLI: callCodeAssist error", { error: String(e) })
        return null
    }
}

// ─── MAIN FETCH ──────────────────────────────────────────────────────────────

export async function geminiCliFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let token = await getAccessToken()
    if (!token) {
        throw new Error("Unauthorized: No gemini-cli token. Run 'navi auth login --provider gemini-cli'")
    }

    const maxAttempts = 3

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Try Code Assist endpoint first
        let caResponse: Response | null = null
        try {
            caResponse = await callCodeAssist(input, init, token)
        } catch (e: any) {
            if (e?.message === "TOKEN_EXPIRED") {
                log.info("Gemini CLI: Token expired, refreshing...")
                token = await getAccessToken(true) ?? token
                continue
            }
            if (e?.message === "INSUFFICIENT_SCOPES") {
                log.warn("Gemini CLI: Insufficient scopes — clearing credentials")
                skipGeminiCliFileMigration = true
                await Auth.remove("gemini-cli")
                throw new Error(
                    "Gemini CLI: Insufficient authentication scopes. " +
                    "Please re-authenticate: navi auth login --provider gemini-cli"
                )
            }
            if (e?.message === "NO_CODE_ASSIST_PROJECT") {
                throw new Error(
                    "Gemini CLI: Your account is missing Gemini Code Assist access. " +
                    "This OAuth flow cannot call the Generative Language API directly. " +
                    "Please enable Gemini Code Assist or use a Gemini API key provider instead."
                )
            }
            throw e
        }


        if (caResponse) {
            if (caResponse.ok) return caResponse

            if (caResponse.status === 429 || caResponse.status >= 500) {
                if (attempt < maxAttempts) {
                    const delay = Math.pow(2, attempt) * 1000
                    log.warn(`Gemini CLI: Code Assist ${caResponse.status}, retrying in ${delay}ms...`)
                    await new Promise(r => setTimeout(r, delay))
                    continue
                }
                return caResponse
            }

            if (caResponse.status === 401 || caResponse.status === 403) {
                if (attempt < maxAttempts) {
                    log.warn(`Gemini CLI: Code Assist ${caResponse.status}, refreshing token...`)
                    token = await getAccessToken(true) ?? token
                    continue
                }
            }

            return caResponse
        }

        // Code Assist not available — fall back to direct generativelanguage.googleapis.com
        if (attempt === 1) {
            log.info("Gemini CLI: Falling back to direct Generative Language API")
        }

        // Build headers with auth token (remove API key header from @ai-sdk/google)
        const directHeaders = new Headers(init?.headers)
        directHeaders.set("Authorization", `Bearer ${token}`)
        directHeaders.delete("x-goog-api-key")

        const directResponse = await fetch(input, { ...init, headers: directHeaders })

        if (directResponse.ok) return directResponse

        if (directResponse.status === 403) {
            const errorText = await directResponse
                .clone()
                .text()
                .catch(() => "")
            if (errorText.includes("insufficient authentication scopes")) {
                log.warn("Gemini CLI: Direct API insufficient scopes — clearing credentials")
                skipGeminiCliFileMigration = true
                await Auth.remove("gemini-cli")
                throw new Error(
                    "Gemini CLI: Insufficient authentication scopes. " +
                    "Please re-authenticate: navi auth login --provider gemini-cli",
                )
            }
        }

        if (directResponse.status === 401 || directResponse.status === 403) {
            if (attempt < maxAttempts) {
                log.warn(`Gemini CLI: Direct API ${directResponse.status}, refreshing token...`)
                token = await getAccessToken(true) ?? token
                continue
            }
        }


        if (directResponse.status === 429 || directResponse.status >= 500) {
            if (attempt < maxAttempts) {
                const delay = Math.pow(2, attempt) * 1000
                log.warn(`Gemini CLI: Direct API ${directResponse.status}, retrying in ${delay}ms...`)
                await new Promise(r => setTimeout(r, delay))
                continue
            }
        }

        return directResponse
    }

    throw new Error(
        "Gemini CLI: Authentication failed after multiple attempts. " +
        "Please re-authenticate: navi auth login --provider gemini-cli"
    )
}

// ─── OAUTH PORT ──────────────────────────────────────────────────────────────

function getAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        let port = 0
        try {
            const portStr = process.env["OAUTH_CALLBACK_PORT"]
            if (portStr) {
                port = parseInt(portStr, 10)
                if (!isNaN(port) && port > 0 && port <= 65535) return resolve(port)
            }
            const server = net.createServer()
            server.listen(0, () => {
                const address = server.address()
                if (address && typeof address === "object") port = address.port
            })
            server.on("listening", () => { server.close(); server.unref() })
            server.on("error", (e) => reject(e))
            server.on("close", () => resolve(port))
        } catch (e) {
            reject(e)
        }
    })
}

// ─── OAUTH CALLBACK SERVER ───────────────────────────────────────────────────

const SIGN_IN_SUCCESS_URL = "https://developers.google.com/gemini-code-assist/auth_success_gemini"
const SIGN_IN_FAILURE_URL = "https://developers.google.com/gemini-code-assist/auth_failure_gemini"

function startCallbackServer(port: number, expectedState: string): Promise<{ code: string }> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                if (!req.url?.includes("/oauth2callback")) {
                    res.writeHead(301, { Location: SIGN_IN_FAILURE_URL })
                    res.end()
                    reject(new Error("Unexpected request: " + req.url))
                    server.close()
                    return
                }

                const qs = new URL(req.url, `http://127.0.0.1:${port}`).searchParams

                if (qs.get("error")) {
                    res.writeHead(301, { Location: SIGN_IN_FAILURE_URL })
                    res.end()
                    server.close()
                    reject(new Error(`Google OAuth error: ${qs.get("error")}. ${qs.get("error_description") || ""}`))
                    return
                }

                const state = qs.get("state")
                if (state !== expectedState) {
                    res.end("State mismatch. Possible CSRF attack")
                    server.close()
                    reject(new Error("OAuth state mismatch. Possible CSRF attack."))
                    return
                }

                const code = qs.get("code")
                if (!code) {
                    res.writeHead(301, { Location: SIGN_IN_FAILURE_URL })
                    res.end()
                    server.close()
                    reject(new Error("No authorization code received"))
                    return
                }

                res.writeHead(301, { Location: SIGN_IN_SUCCESS_URL })
                res.end()
                server.close()
                resolve({ code })
            } catch (e) {
                server.close()
                reject(e)
            }
        })

        server.listen(port, "127.0.0.1", () => {
            log.info("Gemini CLI: OAuth callback server listening", { port })
        })
        server.on("error", (e) => reject(e))

        // 5 minute timeout — same as official gemini-cli
        setTimeout(() => {
            server.close()
            reject(new Error("Authentication timed out after 5 minutes"))
        }, 5 * 60 * 1000)
    })
}

// ─── TOKEN EXCHANGE ───────────────────────────────────────────────────────────

async function exchangeCodeForTokens(
    client: OAuth2Client,
    code: string,
    redirectUri: string,
): Promise<{ access: string; refresh: string; expires: number; email: string } | null> {
    try {
        const { tokens } = await client.getToken({
            code,
            redirect_uri: redirectUri,
        })


        if (!tokens.access_token || !tokens.refresh_token) {
            log.error("Gemini CLI: Token exchange missing access_token or refresh_token")
            return null
        }

        client.setCredentials(tokens)

        // Fetch user email
        let email = "unknown"
        try {
            const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
            })
            if (userInfoRes.ok) {
                const info = (await userInfoRes.json()) as { email?: string }
                email = info.email || "unknown"
            }
        } catch { /* non-fatal */ }

        const expiresInSec = tokens.expiry_date
            ? Math.floor((tokens.expiry_date - Date.now()) / 1000)
            : 3599

        return {
            access: tokens.access_token,
            refresh: tokens.refresh_token,
            expires: Date.now() + expiresInSec * 1000,
            email,
        }
    } catch (e) {
        log.error("Gemini CLI: Token exchange failed", { error: String(e) })
        return null
    }
}

// ─── AUTH HOOK ────────────────────────────────────────────────────────────────

export const GeminiAuthHook: AuthHook = {
    provider: "gemini-cli",

    async loader(getAuth) {
        let auth = await getAuth()
        if (!auth || auth.type !== "oauth") {
            // Try the gemini-cli file migration path
            const fallbackAuth = await getGeminiAuth()
            if (fallbackAuth && fallbackAuth.type === "oauth") {
                auth = fallbackAuth as unknown as typeof auth
            }
        }
        if (!auth || auth.type !== "oauth") return {}

        // Refresh token if expiring soon
        if (auth.expires < Date.now() + 5 * 60 * 1000) {
            try {
                const refreshed = await refreshAccessTokenImpl(auth.refresh)
                await Auth.set("gemini-cli", {
                    ...auth,
                    access: refreshed.access,
                    expires: refreshed.expires,
                })
            } catch (e) {
                log.error("Gemini CLI: Loader token refresh failed", { error: String(e) })
            }
        }

        return {
            baseURL: GEMINI_API_URL,
            fetch: geminiCliFetch,
        }
    },

    methods: [
        {
            type: "oauth",
            label: "OAuth with Google (Gemini CLI)",
            async authorize(): Promise<AuthOAuthResult> {
                // Match official gemini-cli: dynamic port, PKCE, state validation
                const port = await getAvailablePort()
                const redirectUri = `http://127.0.0.1:${port}/oauth2callback`

                const client = new OAuth2Client({
                    clientId: GEMINI_CLIENT_ID,
                    clientSecret: GEMINI_CLIENT_SECRET,
                })

                const state = generateOAuthState()

                const authUrl = client.generateAuthUrl({
                    redirect_uri: redirectUri,
                    access_type: "offline",
                    scope: GEMINI_SCOPES,
                    state,
                })

                // Start callback server BEFORE opening browser
                const callbackPromise = startCallbackServer(port, state)


                // Open browser — don't await, just fire
                open(authUrl).catch((e) =>
                    log.warn("Gemini CLI: Failed to open browser", { error: String(e) })
                )

                return {
                    url: authUrl,
                    instructions: "Complete sign-in in your browser. This window will update automatically.",
                    method: "auto",
                    async callback() {
                        try {
                            const { code } = await callbackPromise
                            const tokens = await exchangeCodeForTokens(client, code, redirectUri)

                            if (!tokens) return { type: "failed" }

                            return {
                                type: "success",
                                provider: "gemini-cli",
                                refresh: tokens.refresh,
                                access: tokens.access,
                                expires: tokens.expires,
                                accountId: tokens.email,
                            }
                        } catch (e) {
                            log.error("Gemini CLI: OAuth callback failed", { error: String(e) })
                            return { type: "failed" }
                        }
                    },
                }
            },
        },
    ],
}

export async function GeminiAuthPlugin(_input: PluginInput): Promise<Hooks> {
    return { auth: GeminiAuthHook }
}


