import type { Hooks, AuthHook, AuthOAuthResult, PluginInput } from "@/plugin"
import { Auth } from "../auth"
import { Log } from "../util/log"
import http from "http"
import { randomBytes } from "crypto"
import net from "net"
import open from "open"

const log = Log.create({ service: "cline" })

const CLINE_API_BASE = "https://api.cline.bot"
const LOCALHOST = "127.0.0.1"

async function getAvailablePort(startPort = 49152, endPort = 65535): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer()
        let port = startPort

        const tryPort = () => {
            server.once("error", (err: NodeJS.ErrnoException) => {
                if (err.code === "EADDRINUSE" && port < endPort) {
                    port++
                    tryPort()
                } else {
                    reject(err)
                }
            })

            server.once("listening", () => {
                server.close(() => {
                    resolve(port)
                })
            })

            server.listen(port, LOCALHOST)
        }

        tryPort()
    })
}

export const ClineAuthHook: AuthHook = {
    provider: "cline",
    async loader(getAuth) {
        const auth = await getAuth()
        if (!auth) return {}
        if (auth.type === "api") {
            return { apiKey: auth.key }
        }
        if (auth.type === "oauth") {
            return { apiKey: auth.access }
        }
        return {}
    },
    methods: [
        {
            type: "oauth",
            label: "OAuth with Cline",
            async authorize(inputs: Record<string, string> = {}): Promise<AuthOAuthResult> {
                log.info("Initiating Cline OAuth")
                try {
                    const state = randomBytes(16).toString("hex")
                    const port = await getAvailablePort()
                    const host = `http://${LOCALHOST}:${port}`
                    const callbackUrl = `${host}/callback`

                    const tokenPromise = new Promise<{ code: string; state: string }>((resolve, reject) => {
                        const server = http.createServer((req, res) => {
                            const url = new URL(req.url!, host)

                            if (url.pathname === "/callback") {
                                const receivedState = url.searchParams.get("state")
                                const code = url.searchParams.get("code")
                                const error = url.searchParams.get("error")

                                if (error) {
                                    res.writeHead(302, { Location: "https://app.cline.bot/auth/failed" })
                                    res.end(() => {
                                        server.close()
                                        reject(new Error(error))
                                    })
                                } else if (!code) {
                                    res.writeHead(302, { Location: "https://app.cline.bot/auth/failed" })
                                    res.end(() => {
                                        server.close()
                                        reject(new Error("Missing authorization code"))
                                    })
                                } else if (receivedState !== state) {
                                    res.writeHead(302, { Location: "https://app.cline.bot/auth/failed" })
                                    res.end(() => {
                                        server.close()
                                        reject(new Error("Invalid state parameter"))
                                    })
                                } else {
                                    res.writeHead(302, { Location: "https://app.cline.bot/auth/success" })
                                    res.end(() => {
                                        server.close()
                                        resolve({ code, state: receivedState })
                                    })
                                }
                            } else {
                                res.writeHead(404, { "Content-Type": "text/plain" })
                                res.end("Not found")
                            }
                        })

                        server.listen(port, LOCALHOST)

                        const timeoutId = setTimeout(() => {
                            server.close()
                            reject(new Error("Authentication timed out"))
                        }, 5 * 60 * 1000)

                        server.on("close", () => {
                            clearTimeout(timeoutId)
                        })
                    })

                    const authUrl = new URL(`${CLINE_API_BASE}/auth`)
                    authUrl.searchParams.set("client_type", "extension")
                    authUrl.searchParams.set("callback_url", callbackUrl)
                    authUrl.searchParams.set("redirect_uri", callbackUrl)
                    authUrl.searchParams.set("state", state)

                    await open(authUrl.toString())

                    return {
                        url: authUrl.toString(),
                        method: "auto" as const,
                        instructions: "Complete sign-in in browser. Waiting for authorization...",
                        async callback() {
                            try {
                                const { code } = await tokenPromise

                                const tokenResponse = await fetch(`${CLINE_API_BASE}/api/v1/token-exchange`, {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                        grant_type: "authorization_code",
                                        code: code,
                                        client_type: "extension",
                                        redirect_uri: callbackUrl,
                                        provider: "cline",
                                    }),
                                })

                                if (!tokenResponse.ok) {
                                    throw new Error(`Token exchange failed: ${tokenResponse.status}`)
                                }

                                const tokenData = await tokenResponse.json()
                                
                                if (!tokenData.success || !tokenData.data?.accessToken) {
                                    throw new Error("Invalid token response")
                                }

                                const expires = new Date(tokenData.data.expiresAt).getTime()

                                await Auth.set("cline", {
                                    type: "oauth",
                                    refresh: tokenData.data.refreshToken || tokenData.data.accessToken,
                                    access: tokenData.data.accessToken,
                                    expires: expires,
                                    accountId: tokenData.data.userInfo?.email || "cline-user",
                                })

                                return {
                                    type: "success" as const,
                                    provider: "cline",
                                    access: tokenData.data.accessToken,
                                    refresh: tokenData.data.refreshToken || tokenData.data.accessToken,
                                    expires: expires,
                                    accountId: tokenData.data.userInfo?.email || "cline-user",
                                }
                            } catch (error) {
                                log.error("Cline OAuth failed", error as Error)
                                return { type: "failed" as const }
                            }
                        }
                    }
                } catch (error) {
                    log.error("Cline OAuth initiation failed", error as Error)
                    return {
                        url: "",
                        method: "code" as const,
                        instructions: "Cline OAuth failed to start. Check your internet connection.",
                        async callback() { return { type: "failed" as const } }
                    }
                }
            },
        },
        {
            type: "api",
            label: "API Key",
            prompts: [
                {
                    type: "text",
                    key: "apiKey",
                    message: "Cline API Key",
                    placeholder: "Enter your Cline API key or account token...",
                }
            ],
            async authorize(inputs: Record<string, string> = {}) {
                if (!inputs.apiKey) return { type: "failed" }

                await Auth.set("cline", {
                    type: "api",
                    key: inputs.apiKey,
                })

                return {
                    type: "success",
                    provider: "cline",
                    key: inputs.apiKey,
                }
            },
        },
    ],
}

export async function ClineAuthPlugin(_input: PluginInput): Promise<Hooks> {
    return { auth: ClineAuthHook }
}

export default ClineAuthPlugin


