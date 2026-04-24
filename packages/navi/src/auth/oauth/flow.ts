/**
 * Shared OAuth 2.0 Authorization Code flow primitives with PKCE support.
 * 
 * Ported from Gemini CLI core.
 */

import http from "node:http"
import crypto from "node:crypto"
import type net from "node:net"
import { URL, URLSearchParams } from "node:url"
import { Log } from "../../util/log"

const log = Log.create({ service: "oauth-flow" })

/**
 * Configuration for an OAuth 2.0 Authorization Code flow.
 */
export interface OAuthFlowConfig {
  clientId: string
  clientSecret?: string
  authorizationUrl: string
  tokenUrl: string
  scopes?: string[]
  audiences?: string[]
  redirectUri?: string
}

/**
 * Configuration subset needed for token refresh operations.
 */
export type OAuthRefreshConfig = Pick<OAuthFlowConfig, "clientId" | "clientSecret" | "scopes" | "audiences">

/**
 * PKCE (Proof Key for Code Exchange) parameters.
 */
export interface PKCEParams {
  codeVerifier: string
  codeChallenge: string
  state: string
}

/**
 * OAuth authorization response from the callback server.
 */
export interface OAuthAuthorizationResponse {
  code: string
  state: string
}

/**
 * OAuth token response from the authorization server.
 */
export interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

/** The path the local callback server listens on. */
export const REDIRECT_PATH = "/oauth/callback"

const HTTP_OK = 200

/**
 * Generate PKCE parameters for OAuth flow.
 */
export function generatePKCEParams(): PKCEParams {
  // Generate code verifier (43-128 characters)
  const codeVerifier = crypto.randomBytes(64).toString("base64url")

  // Generate code challenge using SHA256
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url")

  // Generate state for CSRF protection
  const state = crypto.randomBytes(16).toString("base64url")

  return { codeVerifier, codeChallenge, state }
}

/**
 * Start a local HTTP server to handle OAuth callback.
 */
export function startCallbackServer(
  expectedState: string,
  port?: number,
): {
  port: Promise<number>
  response: Promise<OAuthAuthorizationResponse>
} {
  let portResolve: (port: number) => void
  let portReject: (error: Error) => void
  const portPromise = new Promise<number>((resolve, reject) => {
    portResolve = resolve
    portReject = reject
  })

  let timeoutId: NodeJS.Timeout | undefined

  const responsePromise = new Promise<OAuthAuthorizationResponse>((resolve, reject) => {
    let serverPort: number

    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      try {
        const url = new URL(req.url!, `http://127.0.0.1:${serverPort}`)

        if (url.pathname !== REDIRECT_PATH) {
          res.writeHead(404)
          res.end("Not found")
          return
        }

        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")

        if (error) {
          res.writeHead(HTTP_OK, { "Content-Type": "text/html" })
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                <h1>Authentication Failed</h1>
                <p>Error: ${error.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
                <p>${(url.searchParams.get("error_description") || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          reject(new Error(`OAuth error: ${error}`))
          return
        }

        if (!code || !state) {
          res.writeHead(400)
          res.end("Missing code or state parameter")
          return
        }

        if (state !== expectedState) {
          res.writeHead(400)
          res.end("Invalid state parameter")
          server.close()
          reject(new Error("State mismatch - possible CSRF attack"))
          return
        }

        // Send success response to browser
        res.writeHead(HTTP_OK, { "Content-Type": "text/html" })
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
              <h1>Authentication Successful!</h1>
              <p>You can close this window and return to Navi.</p>
              <script>window.close();</script>
            </body>
          </html>
        `)

        server.close()
        resolve({ code, state })
      } catch (error) {
        server.close()
        reject(error)
      }
    })

    server.on("error", (error) => {
      portReject(error)
      reject(error)
    })

    let listenPort = 0
    const portStr = process.env["OAUTH_CALLBACK_PORT"]
    if (portStr) {
      const envPort = parseInt(portStr, 10)
      if (envPort > 0 && envPort <= 65535) {
        listenPort = envPort
      }
    } else if (port !== undefined) {
      listenPort = port
    }

    server.listen(listenPort, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo
      serverPort = address.port
      log.debug(`OAuth callback server listening on port ${serverPort}`)
      portResolve(serverPort)
    })

    const abortController = new AbortController()
    timeoutId = setTimeout(() => {
      abortController.abort(new Error("OAuth callback timeout"))
    }, 5 * 60 * 1000)
    timeoutId.unref()

    const onAbort = () => {
      server.close()
      reject(abortController.signal.reason)
    }
    abortController.signal.addEventListener("abort", onAbort, { once: true })

    server.on("close", () => {
      abortController.signal.removeEventListener("abort", onAbort)
      if (timeoutId) clearTimeout(timeoutId)
    })
  })

  return {
    port: portPromise,
    response: responsePromise,
  }
}

/**
 * Build the authorization URL for the OAuth flow.
 */
export function buildAuthorizationUrl(
  config: OAuthFlowConfig,
  pkceParams: PKCEParams,
  redirectPort: number,
): string {
  const redirectUri = config.redirectUri || `http://127.0.0.1:${redirectPort}${REDIRECT_PATH}`

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state: pkceParams.state,
    code_challenge: pkceParams.codeChallenge,
    code_challenge_method: "S256",
  })

  if (config.scopes && config.scopes.length > 0) {
    params.append("scope", config.scopes.join(" "))
  }

  if (config.audiences && config.audiences.length > 0) {
    params.append("audience", config.audiences.join(" "))
  }

  const url = new URL(config.authorizationUrl)
  params.forEach((value, key) => {
    url.searchParams.append(key, value)
  })
  return url.toString()
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCodeForToken(
  config: OAuthFlowConfig,
  code: string,
  codeVerifier: string,
  redirectPort: number,
): Promise<OAuthTokenResponse> {
  const redirectUri = config.redirectUri || `http://127.0.0.1:${redirectPort}${REDIRECT_PATH}`

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: config.clientId,
  })

  if (config.clientSecret) {
    params.append("client_secret", config.clientSecret)
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed: ${response.status} - ${text}`)
  }

  return (await response.json()) as OAuthTokenResponse
}

/**
 * Refresh an access token using a refresh token.
 */
export async function refreshAccessToken(
  config: OAuthRefreshConfig,
  refreshToken: string,
  tokenUrl: string,
): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
  })

  if (config.clientSecret) {
    params.append("client_secret", config.clientSecret)
  }

  if (config.scopes && config.scopes.length > 0) {
    params.append("scope", config.scopes.join(" "))
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed: ${response.status} - ${text}`)
  }

  return (await response.json()) as OAuthTokenResponse
}
