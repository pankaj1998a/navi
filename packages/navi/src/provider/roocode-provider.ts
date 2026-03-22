import type { Hooks, AuthHook, AuthOuathResult, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import { Log } from "../util/log"
import http from "http"
import { randomBytes } from "crypto"
import net from "net"
import open from "open"

const log = Log.create({ service: "roocode" })

const AUTH_BASE_URL = "https://app.roocode.com"
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

export const RoocodeAuthHook: AuthHook = {
    provider: "roocode",
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
            label: "OAuth with Roo Code",
            async authorize(inputs: Record<string, string> = {}): Promise<AuthOuathResult> {
                log.info("Initiating Roo Code OAuth")
                try {
                    const state = randomBytes(16).toString("hex")
                    const port = await getAvailablePort()
                    const host = `http://${LOCALHOST}:${port}`

                    const tokenPromise = new Promise<{ token: string; state: string }>((resolve, reject) => {
                        const server = http.createServer((req, res) => {
                            const url = new URL(req.url!, host)

                            if (url.pathname === "/callback") {
                                const receivedState = url.searchParams.get("state")
                                const token = url.searchParams.get("token")
                                const error = url.searchParams.get("error")

                                if (error) {
                                    const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=error-in-callback`)
                                    errorUrl.searchParams.set("message", error)
                                    res.writeHead(302, { Location: errorUrl.toString() })
                                    res.end(() => {
                                        server.close()
                                        reject(new Error(error))
                                    })
                                } else if (!token) {
                                    const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=missing-token`)
                                    errorUrl.searchParams.set("message", "Missing token in callback")
                                    res.writeHead(302, { Location: errorUrl.toString() })
                                    res.end(() => {
                                        server.close()
                                        reject(new Error("Missing token in callback"))
                                    })
                                } else if (receivedState !== state) {
                                    const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=invalid-state-parameter`)
                                    errorUrl.searchParams.set("message", "Invalid state parameter")
                                    res.writeHead(302, { Location: errorUrl.toString() })
                                    res.end(() => {
                                        server.close()
                                        reject(new Error("Invalid state parameter"))
                                    })
                                } else {
                                    res.writeHead(302, { Location: `${AUTH_BASE_URL}/cli/sign-in?success=true` })
                                    res.end(() => {
                                        server.close()
                                        resolve({ token, state: receivedState })
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

                    const authUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in`)
                    authUrl.searchParams.set("state", state)
                    authUrl.searchParams.set("callback", `${host}/callback`)

                    await open(authUrl.toString())

                    return {
                        url: authUrl.toString(),
                        method: "auto" as const,
                        instructions: "Complete sign-in in browser. Waiting for authorization...",
                        async callback() {
                            try {
                                const { token } = await tokenPromise
                                const expires = Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days

                                await Auth.set("roocode", {
                                    type: "oauth",
                                    refresh: token,
                                    access: token,
                                    expires: expires,
                                    accountId: "roocode-user",
                                })

                                return {
                                    type: "success" as const,
                                    provider: "roocode",
                                    access: token,
                                    refresh: token,
                                    expires: expires,
                                    accountId: "roocode-user",
                                }
                            } catch (error) {
                                log.error("Roo Code OAuth failed", error as Error)
                                return { type: "failed" as const }
                            }
                        }
                    }
                } catch (error) {
                    log.error("Roo Code OAuth initiation failed", error as Error)
                    return {
                        url: "",
                        method: "code" as const,
                        instructions: "Roo Code OAuth failed to start. Check your internet connection.",
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
                    message: "Roo Code API Key",
                    placeholder: "Enter your Roo Code API key or session token...",
                }
            ],
            async authorize(inputs: Record<string, string> = {}) {
                if (!inputs.apiKey) return { type: "failed" }

                await Auth.set("roocode", {
                    type: "api",
                    key: inputs.apiKey,
                })

                return {
                    type: "success",
                    provider: "roocode",
                    key: inputs.apiKey,
                }
            },
        },
    ],
}

export async function RoocodeAuthPlugin(_input: PluginInput): Promise<Hooks> {
    return { auth: RoocodeAuthHook }
}

export default RoocodeAuthPlugin
