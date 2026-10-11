import type { Hooks, AuthHook, PluginInput } from "@navi-ai/plugin"
import { Auth } from "../auth"
import * as Log from "@navi-ai/core/util/log"
import { homedir } from "os"
import { join } from "path"
import { readFile, access } from "fs/promises"

const log = Log.create({ service: "claude-cli-auth" })

export function getClaudeCliConfigPaths(): string[] {
  const home = homedir()
  const paths: string[] = [
    join(home, ".claude.json"),
    join(home, ".claude", "credentials.json"),
    join(home, ".claude", "config.json"),
    join(home, ".config", "claude", "config.json"),
  ]

  const appData = process.env.APPDATA
  if (appData) {
    paths.push(join(appData, "Claude", "credentials.json"))
    paths.push(join(appData, "Claude", "claude.json"))
  }

  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    paths.push(join(localAppData, "Claude", "credentials.json"))
  }

  return paths
}

export async function detectClaudeCliCredentials(): Promise<{ apiKey?: string; email?: string } | undefined> {
  if (process.env.ANTHROPIC_API_KEY) {
    return { apiKey: process.env.ANTHROPIC_API_KEY.trim() }
  }

  for (const configPath of getClaudeCliConfigPaths()) {
    try {
      await access(configPath)
      const content = await readFile(configPath, "utf-8")
      const parsed = JSON.parse(content)
      const apiKey = parsed.primaryApiKey || parsed.sessionKey || parsed.apiKey || parsed.token || parsed.oauthAccount?.token
      const email = parsed.oauthAccount?.emailAddress || parsed.email
      if (apiKey) {
        log.info("Detected local Claude Code credentials", { path: configPath })
        return { apiKey, email }
      }
    } catch {
      // Continue to next path
    }
  }

  return undefined
}

export const ClaudeCliAuthHook: AuthHook = {
  provider: "claude-cli",
  async loader(getAuth) {
    const auth = await getAuth()
    let apiKey = auth?.type === "api" ? auth.key : auth?.type === "oauth" ? auth.access : undefined

    if (!apiKey) {
      const detected = await detectClaudeCliCredentials()
      if (detected?.apiKey) {
        apiKey = detected.apiKey
      }
    }

    return {
      apiKey: apiKey || "NOT_USED",
      headers: {
        "anthropic-beta":
          "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,prompt-caching-2024-07-31",
      },
    }
  },
  methods: [
    {
      type: "api",
      label: "Import from Claude Code CLI (claude login)",
      async authorize() {
        const detected = await detectClaudeCliCredentials()
        if (detected?.apiKey) {
          await Auth.set("claude-cli", {
            type: "api",
            key: detected.apiKey,
          })
          return {
            type: "success",
            provider: "claude-cli",
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
      label: "Enter Anthropic API Key (sk-ant-...)",
      prompts: [
        {
          type: "text",
          key: "apiKey",
          message: "Anthropic / Claude API Key",
          placeholder: "sk-ant-...",
          validate: (x) => (x && x.startsWith("sk-ant-") ? undefined : "Valid Anthropic key required (sk-ant-...)"),
        },
      ],
      async authorize(inputs = {}) {
        if (!inputs.apiKey) return { type: "failed" }

        await Auth.set("claude-cli", {
          type: "api",
          key: inputs.apiKey.trim(),
        })

        return {
          type: "success",
          provider: "claude-cli",
          key: inputs.apiKey.trim(),
        }
      },
    },
  ],
}

export async function ClaudeCliAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: ClaudeCliAuthHook,
    "chat.headers": async (incoming, output) => {
      if (incoming.model.providerID !== "claude-cli") return
      output.headers["anthropic-beta"] =
        "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,prompt-caching-2024-07-31"
    },
  }
}

export default ClaudeCliAuthPlugin
