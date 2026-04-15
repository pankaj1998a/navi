import type { Hooks, AuthHook, AuthOuathResult, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import { Log } from "../util/log"

const log = Log.create({ service: "kilocode" })

export const KilocodeAuthHook: AuthHook = {
    provider: "kilocode",
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
            label: "OAuth with Kilocode",
            async authorize(inputs: Record<string, string> = {}): Promise<AuthOuathResult> {
                log.info("Initiating Kilo Code Device Auth")
                try {
                    const response = await fetch("https://api.kilo.ai/api/device-auth/codes", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" }
                    })

                    if (!response.ok) {
                        throw new Error(`Kilo Code API returned ${response.status}`)
                    }

                    const data = await response.json() as { code: string; verificationUrl: string; expiresIn: number }

                    return {
                        url: data.verificationUrl,
                        method: "auto" as const,
                        instructions: `Please visit ${data.verificationUrl} and enter this code: ${data.code}.\nWaiting for authorization... (Expires in ${data.expiresIn}s)`,
                        async callback() {
                            const startTime = Date.now()
                            const timeout = data.expiresIn * 1000
                            const interval = 3000

                            while (Date.now() - startTime < timeout) {
                                const pollResponse = await fetch(`https://api.kilo.ai/api/device-auth/codes/${data.code}`)

                                if (pollResponse.ok) {
                                    const pollData = await pollResponse.json() as {
                                        status: "pending" | "approved" | "denied" | "expired";
                                        token?: string;
                                        userEmail?: string;
                                    }

                                    if (pollData.status === "approved" && pollData.token) {
                                        const expires = Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days

                                        await Auth.set("kilocode", {
                                            type: "oauth",
                                            refresh: pollData.token,
                                            access: pollData.token,
                                            expires: expires,
                                            accountId: pollData.userEmail || "unknown",
                                        })

                                        return {
                                            type: "success" as const,
                                            provider: "kilocode",
                                            access: pollData.token,
                                            refresh: pollData.token,
                                            expires: expires,
                                            accountId: pollData.userEmail || "unknown",
                                        }
                                    } else if (pollData.status === "denied" || pollData.status === "expired") {
                                        log.warn(`Kilo Code authorization ${pollData.status}`)
                                        return { type: "failed" as const }
                                    }
                                } else {
                                    if (pollResponse.status === 403) {
                                        log.warn("Kilo Code authorization denied")
                                        return { type: "failed" as const }
                                    }
                                    if (pollResponse.status === 410) {
                                        log.warn("Kilo Code authorization expired")
                                        return { type: "failed" as const }
                                    }
                                    // 202 is handled by just continuing the loop
                                }
                                await new Promise(r => setTimeout(r, interval))
                            }
                            return { type: "failed" as const }
                        }
                    }
                } catch (error) {
                    log.error("Kilocode OAuth initiation failed", error as Error)
                    return {
                        url: "",
                        method: "code" as const,
                        instructions: "Kilo Code OAuth failed to start. Check your internet connection.",
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
                    message: "Kilo Code API Key (JWT)",
                    placeholder: "Enter your Kilo Code JWT token...",
                }
            ],
            async authorize(inputs: Record<string, string> = {}) {
                if (!inputs.apiKey) return { type: "failed" }

                await Auth.set("kilocode", {
                    type: "api",
                    key: inputs.apiKey,
                })

                return {
                    type: "success",
                    provider: "kilocode",
                    key: inputs.apiKey,
                }
            },
        },
    ],
}

export async function KilocodeAuthPlugin(_input: PluginInput): Promise<Hooks> {
    return {
        auth: KilocodeAuthHook
    }
}

export default KilocodeAuthPlugin


