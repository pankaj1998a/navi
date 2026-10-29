import type { Hooks, AuthHook, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import * as Log from "@navi-ai/core/util/log"
import { InstallationVersion } from "@navi-ai/core/installation/version"
import { Flag } from "@navi-ai/core/flag/flag"
import { homedir } from "os"
import { join } from "path"
import { readFile, access } from "fs/promises"

const log = Log.create({ service: "opencode-auth" })

const DEFAULT_OPENCODE_SERVER_URL = "http://127.0.0.1:4096"
const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1"

export function getOpenCodeAuthPaths(): string[] {
  const home = homedir()
  const paths: string[] = []

  const xdgData = process.env.XDG_DATA_HOME
  if (xdgData) {
    paths.push(join(xdgData, "opencode", "auth.json"))
  }

  paths.push(join(home, ".local", "share", "opencode", "auth.json"))
  paths.push(join(home, ".config", "opencode", "auth.json"))

  const appData = process.env.APPDATA
  if (appData) {
    paths.push(join(appData, "opencode", "auth.json"))
  }

  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    paths.push(join(localAppData, "opencode", "auth.json"))
  }

  return paths
}

export async function detectOpenCodeLocalAuth(): Promise<{ apiKey?: string; serverPassword?: string } | undefined> {
  if (process.env.OPENCODE_API_KEY) {
    return { apiKey: process.env.OPENCODE_API_KEY.trim() }
  }

  if (process.env.OPENCODE_AUTH_CONTENT) {
    try {
      const data = JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
      const key = data["opencode"]?.key || data["opencode-go"]?.key || data.tokens?.access_token || data.apiKey
      if (key) return { apiKey: key }
    } catch {
      // ignore JSON parse error
    }
  }

  for (const authPath of getOpenCodeAuthPaths()) {
    try {
      await access(authPath)
      const content = await readFile(authPath, "utf-8")
      const parsed = JSON.parse(content)
      const key = parsed["opencode"]?.key || parsed["opencode-go"]?.key || parsed.tokens?.access_token || parsed.apiKey || parsed.token
      if (key) {
        log.info("Detected local OpenCode credentials", { path: authPath })
        return { apiKey: key }
      }
    } catch {
      // Continue to next path
    }
  }

  return undefined
}

export async function checkOpenCodeServer(serverUrl: string = DEFAULT_OPENCODE_SERVER_URL): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/global/health`, { signal: AbortSignal.timeout(1000) })
    if (res.ok) return true
  } catch {
    // try fallback doc
  }

  try {
    const res = await fetch(`${serverUrl}/doc`, { signal: AbortSignal.timeout(1000) })
    if (res.ok) return true
  } catch {
    // not running
  }

  return false
}

const spawnState: { up: boolean; inflight: Promise<boolean> | undefined; lastFailureAt: number } = {
  up: false,
  inflight: undefined,
  lastFailureAt: 0,
}

const OPENCODE_SPAWN_COOLDOWN_MS = 60_000

export async function ensureOpenCodeServer(serverUrl: string = DEFAULT_OPENCODE_SERVER_URL, retry = false): Promise<boolean> {
  if (spawnState.up) return true
  if (spawnState.inflight) return spawnState.inflight

  if (retry) spawnState.lastFailureAt = 0

  const inCooldown = spawnState.lastFailureAt > 0 && Date.now() - spawnState.lastFailureAt < OPENCODE_SPAWN_COOLDOWN_MS
  if (inCooldown) {
    const healthy = await checkOpenCodeServer(serverUrl)
    if (healthy) {
      spawnState.up = true
      spawnState.lastFailureAt = 0
      return true
    }
    return false
  }

  const attempt = (async () => {
    try {
      if (await checkOpenCodeServer(serverUrl)) return true

      const isWindows = process.platform === "win32"
      const command = isWindows ? Bun.which("opencode") : "opencode"
      if (!command) {
        log.warn("OpenCode server not running and opencode binary not found in PATH, skipping auto-spawn", { serverUrl })
        return false
      }

      const { default: launch } = await import("cross-spawn")
      const child = launch(command, ["serve", "--port", "4096"], {
        stdio: "ignore",
        windowsHide: true,
      })
      child.on("error", (err) => log.warn("Failed to auto-spawn OpenCode server", { error: String(err) }))
      child.unref()

      const start = Date.now()
      while (Date.now() - start < 8000) {
        await new Promise((r) => setTimeout(r, 250))
        if (await checkOpenCodeServer(serverUrl)) return true
      }
      return false
    } catch (err) {
      log.warn("Failed to auto-spawn OpenCode server", { error: String(err) })
      return false
    }
  })()

  spawnState.inflight = attempt
  const result = await attempt
  spawnState.inflight = undefined
  spawnState.up = result
  spawnState.lastFailureAt = result ? 0 : Date.now()
  return result
}

export const OpenCodeAuthHook: AuthHook = {
  provider: "opencode",
  async loader(getAuth) {
    const auth = await getAuth()
    let apiKey = auth?.type === "api" ? auth.key : auth?.type === "oauth" ? auth.access : undefined
    let baseURL = (auth && "metadata" in auth ? (auth as { metadata?: { url?: string } }).metadata?.url : undefined) || OPENCODE_ZEN_BASE_URL

    if (!apiKey) {
      const detected = await detectOpenCodeLocalAuth()
      if (detected?.apiKey) {
        apiKey = detected.apiKey
      }
    }

    if (!apiKey && (await checkOpenCodeServer(DEFAULT_OPENCODE_SERVER_URL))) {
      baseURL = `${DEFAULT_OPENCODE_SERVER_URL}/v1`
      apiKey = "public"
    }

    return {
      apiKey: apiKey || "public",
      baseURL,
      headers: {
        "User-Agent": `opencode/${InstallationVersion}`,
        "x-opencode-client": Flag.NAVI_CLIENT || "cli",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    }
  },
  methods: [
    {
      type: "api",
      label: "Import from OpenCode CLI (opencode auth login)",
      async authorize() {
        const detected = await detectOpenCodeLocalAuth()
        if (detected?.apiKey) {
          await Auth.set("opencode", {
            type: "api",
            key: detected.apiKey,
          })
          await Auth.set("opencode-cli", {
            type: "api",
            key: detected.apiKey,
          })
          return {
            type: "success",
            provider: "opencode",
            key: detected.apiKey,
          }
        }

        return {
          type: "failed",
        }
      },
    },
    {
      type: "api",
      label: "Connect to local OpenCode server (http://127.0.0.1:4096)",
      prompts: [
        {
          type: "text",
          key: "serverUrl",
          message: "OpenCode server URL",
          placeholder: DEFAULT_OPENCODE_SERVER_URL,
        },
        {
          type: "text",
          key: "serverPassword",
          message: "Server Password (optional)",
          placeholder: "Leave empty if password not required",
        },
      ],
      async authorize(inputs = {}) {
        const serverUrl = (inputs.serverUrl?.trim() || DEFAULT_OPENCODE_SERVER_URL).replace(/\/+$/, "")
        const password = inputs.serverPassword?.trim() || "public"

        await Auth.set("opencode", {
          type: "api",
          key: password,
          metadata: { url: `${serverUrl}/v1` },
        })

        await Auth.set("opencode-cli", {
          type: "api",
          key: password,
          metadata: { url: `${serverUrl}/v1` },
        })

        return {
          type: "success",
          provider: "opencode",
          key: password,
        }
      },
    },
    {
      type: "api",
      label: "OpenCode API Key",
      prompts: [
        {
          type: "text",
          key: "apiKey",
          message: "OpenCode Go / Zen API Key",
          placeholder: "Enter your OpenCode API key...",
          validate: (x) => (x && x.length > 0 ? undefined : "API key required"),
        },
      ],
      async authorize(inputs = {}) {
        if (!inputs.apiKey) return { type: "failed" }

        await Auth.set("opencode", {
          type: "api",
          key: inputs.apiKey.trim(),
        })
        await Auth.set("opencode-cli", {
          type: "api",
          key: inputs.apiKey.trim(),
        })

        return {
          type: "success",
          provider: "opencode",
          key: inputs.apiKey.trim(),
        }
      },
    },
  ],
}

export async function OpenCodeAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: OpenCodeAuthHook,
    "chat.headers": async (incoming, output) => {
      if (incoming.model.providerID !== "opencode" && incoming.model.providerID !== "opencode-cli") return
      output.headers["User-Agent"] = `opencode/${InstallationVersion}`
      output.headers["x-opencode-client"] = Flag.NAVI_CLIENT || "cli"
    },
  }
}

export default OpenCodeAuthPlugin
