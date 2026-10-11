import type { Hooks, AuthHook, AuthOuathResult, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import * as Log from "@navi-ai/core/util/log"
import { homedir } from "os"
import { join } from "path"
import { readFile, access } from "fs/promises"
import { spawnSync } from "child_process"
import { generatePKCEParams, startCallbackServer, buildAuthorizationUrl, exchangeCodeForToken } from "../auth/oauth/flow"
import { openBrowserSecurely, shouldLaunchBrowser } from "../auth/oauth/browser"

const log = Log.create({ service: "antigravity-auth" })

export const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
export const ANTIGRAVITY_CLIENT_SECRET = ""
export const GOOGLE_OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]

let cachedAgyBin: string | undefined = undefined

export function findAgyExecutable(): string | undefined {
  if (cachedAgyBin) return cachedAgyBin
  if (process.env.AGY_BIN_PATH) {
    cachedAgyBin = process.env.AGY_BIN_PATH
    return cachedAgyBin
  }

  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
  const candidates = [
    join(localAppData, "agy", "bin", "agy.exe"),
    join(localAppData, "agy", "bin", "agy.cmd"),
    "agy.exe",
    "agy",
    join(homedir(), ".local", "bin", "agy"),
    "/usr/local/bin/agy",
  ]

  for (const candidate of candidates) {
    try {
      const res = spawnSync(candidate, ["--help"], { stdio: "ignore", windowsHide: true })
      if (res.status === 0) {
        cachedAgyBin = candidate
        return cachedAgyBin
      }
    } catch {
      // continue
    }
  }

  return undefined
}

export async function detectAntigravityCredentials(): Promise<{
  accessToken?: string
  refreshToken?: string
  expires?: number
  email?: string
  hasAgyCli?: boolean
} | undefined> {
  const agyBin = findAgyExecutable()

  // 1. Check existing Navi auth under google-antigravity or antigravity
  try {
    const existing = (await Auth.get("google-antigravity")) || (await Auth.get("antigravity"))
    if (existing) {
      if (existing.type === "oauth") {
        return {
          accessToken: existing.access,
          refreshToken: existing.refresh,
          expires: existing.expires,
          email: existing.accountId,
          hasAgyCli: !!agyBin,
        }
      }
      if (existing.type === "api") {
        return {
          accessToken: existing.key,
          hasAgyCli: !!agyBin,
        }
      }
    }
  } catch {
    // continue
  }

  // 2. Check ~/.gemini/oauth_creds.json
  const geminiCredsPath = join(homedir(), ".gemini", "oauth_creds.json")
  try {
    await access(geminiCredsPath)
    const content = await readFile(geminiCredsPath, "utf-8")
    const parsed = JSON.parse(content) as {
      access_token?: string
      refresh_token?: string
      expiry_date?: number
      email?: string
    }
    if (parsed.access_token || parsed.refresh_token) {
      log.info("Detected local Antigravity credentials", { path: geminiCredsPath })
      return {
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token,
        expires: parsed.expiry_date,
        email: parsed.email,
        hasAgyCli: !!agyBin,
      }
    }
  } catch {
    // continue
  }

  if (agyBin) {
    return { hasAgyCli: true }
  }

  return undefined
}

export const AntigravityAuthHook: AuthHook = {
  provider: "antigravity",
  async loader(getAuth) {
    const auth = await getAuth()
    let token = auth?.type === "api" ? auth.key : auth?.type === "oauth" ? auth.access : undefined

    if (!token) {
      const detected = await detectAntigravityCredentials()
      if (detected?.accessToken) {
        token = detected.accessToken
      }
    }

    return {
      apiKey: token || "NOT_USED",
    }
  },
  methods: [
    {
      type: "api",
      label: "Use local Google Antigravity CLI / IDE session (automatic)",
      async authorize() {
        const detected = await detectAntigravityCredentials()
        if (detected) {
          if (detected.refreshToken || detected.accessToken) {
            await Auth.set("antigravity", {
              type: "oauth",
              access: detected.accessToken || "",
              refresh: detected.refreshToken || "",
              expires: detected.expires || Date.now() + 3600 * 1000,
              accountId: detected.email || "antigravity-user",
            })
            await Auth.set("google-antigravity", {
              type: "oauth",
              access: detected.accessToken || "",
              refresh: detected.refreshToken || "",
              expires: detected.expires || Date.now() + 3600 * 1000,
              accountId: detected.email || "antigravity-user",
            })
            return {
              type: "success",
              provider: "antigravity",
              key: detected.accessToken || "agy-local-session",
            }
          }

          if (detected.hasAgyCli) {
            await Auth.set("antigravity", {
              type: "api",
              key: "agy-local-session",
            })
            await Auth.set("google-antigravity", {
              type: "api",
              key: "agy-local-session",
            })
            return {
              type: "success",
              provider: "antigravity",
              key: "agy-local-session",
            }
          }
        }

        return {
          type: "failed",
        }
      },
    },
    {
      type: "oauth",
      label: "Sign in with Google (Google Antigravity OAuth)",
      async authorize(): Promise<AuthOuathResult> {
        const pkce = generatePKCEParams()
        const config = {
          clientId: ANTIGRAVITY_CLIENT_ID,
          clientSecret: ANTIGRAVITY_CLIENT_SECRET,
          authorizationUrl: GOOGLE_OAUTH_AUTH_URL,
          tokenUrl: GOOGLE_OAUTH_TOKEN_URL,
          scopes: ANTIGRAVITY_SCOPES,
        }

        if (shouldLaunchBrowser()) {
          const { port, response } = startCallbackServer(pkce.state)
          const redirectPort = await port
          const authUrl = buildAuthorizationUrl(config, pkce, redirectPort)

          openBrowserSecurely(authUrl).catch((error) => {
            log.warn("Antigravity: failed to open browser", { error: String(error) })
          })

          return {
            url: authUrl,
            instructions: "Complete Google sign-in in your browser. Navi will continue automatically.",
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
                  // ignore
                }

                const refreshToken = tokens.refresh_token || ""
                const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : Date.now() + 3600 * 1000

                await Auth.set("antigravity", {
                  type: "oauth",
                  access: tokens.access_token,
                  refresh: refreshToken,
                  expires: expiresAt,
                  accountId: email,
                })
                await Auth.set("google-antigravity", {
                  type: "oauth",
                  access: tokens.access_token,
                  refresh: refreshToken,
                  expires: expiresAt,
                  accountId: email,
                })

                return {
                  type: "success",
                  provider: "antigravity",
                  access: tokens.access_token,
                  refresh: refreshToken,
                  expires: expiresAt,
                  accountId: email,
                }
              } catch (error) {
                log.error("Antigravity OAuth exchange failed", { error: String(error) })
                return { type: "failed" }
              }
            },
          }
        }

        return {
          url: "",
          instructions: "Browser sign-in is disabled in this environment.",
          method: "code",
          async callback(_code?: string) {
            return { type: "failed" }
          },
        }
      },
    },
  ],
}

export async function AntigravityAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: AntigravityAuthHook,
  }
}
