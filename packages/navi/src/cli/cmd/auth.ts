import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy } from "remeda"
import path from "path"
import os from "os"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import type { Hooks } from "@navi-ai/plugin"

type PluginAuth = NonNullable<Hooks["auth"]>

export const PROVIDER_ALIASES: Record<string, string> = {
  "claude-code": "anthropic",
  "qwen-code": "qwen-cli",
}

export const EXTRA_PROVIDER_ENTRIES: Array<{ id: string; name: string }> = [
  { id: "google-antigravity", name: "Antigravity (Google OAuth)" },
  { id: "gemini-cli", name: "Gemini CLI" },
  { id: "claude-code", name: "Claude Code" },
  { id: "qwen-code", name: "Qwen Code" },
]

export function resolveProviderForAuth(provider: string): string {
  return PROVIDER_ALIASES[provider] ?? provider
}

/**
 * Handle plugin-based authentication flow.
 * Returns true if auth was handled, false if it should fall through to default handling.
 */
async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string): Promise<boolean> {
  if (!plugin.auth.methods) {
    throw new Error(`Plugin for provider "${provider}" is missing auth methods`)
  }
  let index = 0
  if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: [
        ...plugin.auth.methods.map((x, index) => ({
          label: x.label,
          value: index.toString(),
        })),
      ],
    })
    if (prompts.isCancel(method)) throw new UI.CancelledError()
    index = parseInt(method)
  }
  const method = plugin.auth.methods[index]

  // Handle prompts for all auth types
  await Bun.sleep(10)
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.condition && !prompt.condition(inputs)) {
        continue
      }
      if (prompt.type === "select") {
        const value = await prompts.select({
          message: prompt.message,
          options: prompt.options,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      } else {
        const value = await prompts.text({
          message: prompt.message,
          placeholder: prompt.placeholder,
          validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      }
    }
  }

  if (method.type === "oauth") {
    const authorize = await method.authorize(inputs)

    if (authorize.url) {
      prompts.log.info("Go to: " + authorize.url)
    }

    if (authorize.method === "auto") {
      if (authorize.instructions) {
        prompts.log.info(authorize.instructions)
      }
      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop("Failed to authorize", 1)
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        // Refresh provider state and fetch the latest models for this provider when enabled.
        await Provider.refreshProviderOnConnect(saveProvider)
        spinner.stop("Login successful")
      }
    }

    if (authorize.method === "code") {
      const code = await prompts.text({
        message: "Paste the authorization code here: ",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(code)) throw new UI.CancelledError()
      const result = await authorize.callback(code)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        if ("refresh" in result) {
          const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
          await Auth.set(saveProvider, {
            type: "oauth",
            refresh,
            access,
            expires,
            ...extraFields,
          })
        }
        if ("key" in result) {
          await Auth.set(saveProvider, {
            type: "api",
            key: result.key,
          })
        }
        // Refresh provider state and fetch the latest models for this provider when enabled.
        await Provider.refreshProviderOnConnect(saveProvider)
        prompts.log.success("Login successful")
      }
    }

    prompts.outro("Done")
    return true
  }

  if (method.type === "api") {
    if (method.authorize) {
      const result = await method.authorize(inputs)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        await Auth.set(saveProvider, {
          type: "api",
          key: result.key,
        })
        // Refresh provider state and fetch the latest models for this provider when enabled.
        await Provider.refreshProviderOnConnect(saveProvider)
        prompts.log.success("Login successful")
      }
      prompts.outro("Done")
      return true
    }
  }

  return false
}

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs.command(AuthLoginCommand).command(AuthLogoutCommand).command(AuthListCommand).demandCommand(),
  async handler() { },
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "navi auth provider",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
        let provider = args.url
        if (provider) {
          if (provider.startsWith("http://") || provider.startsWith("https://")) {
            const wellknown = await fetch(`${provider}/.well-known/navi`).then((x) => x.json() as any)
            prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
            const proc = Bun.spawn({
              cmd: wellknown.auth.command,
              stdout: "pipe",
            })
            const exit = await proc.exited
            if (exit !== 0) {
              prompts.log.error("Failed")
              prompts.outro("Done")
              return
            }
            const token = await new Response(proc.stdout).text()
            await Auth.set(provider, {
              type: "wellknown",
              key: wellknown.auth.env,
              token: token.trim(),
            })
            prompts.log.success("Logged into " + provider)
            prompts.outro("Done")
            return
          }
        }
        await ModelsDev.refresh().catch(() => { })

        const config = await Config.get()

        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const providers = await ModelsDev.get().then((x) => {
          const filtered: Record<string, (typeof x)[string]> = {}
          const shouldInclude = (id: string) => (enabled ? enabled.has(id) : true) && !disabled.has(id)

          for (const [key, value] of Object.entries(x)) {
            if (shouldInclude(key)) {
              filtered[key] = value
            }
          }

          // Hide canonical provider IDs when we expose a login alias in UI.
          delete filtered["qwen-cli"]

          // Inject known providers that may not yet be available from models.dev.
          for (const extra of EXTRA_PROVIDER_ENTRIES) {
            if (!shouldInclude(extra.id) || filtered[extra.id]) continue
            filtered[extra.id] = {
              id: extra.id,
              name: extra.name,
              env: [],
              models: {},
            }
          }

          return filtered
        })

        const priority: Record<string, number> = {
          "gemini-cli": 0,
          "qwen-code": 0,
          "google-antigravity": 0,
          "claude-code": 1,
          navi: 1,
          anthropic: 2,
          "github-copilot": 3,
          openai: 4,
          google: 5,
          openrouter: 6,
          kilocode: 7,
          cline: 8,
          roocode: 9,
          Navi: 10,
          vercel: 11,
        }
        if (!provider) {
          const result = await prompts.autocomplete({
            message: "Select provider",
            maxItems: 8,
            options: [
              ...pipe(
                Object.values(providers),
                sortBy(
                  (x) => priority[x.id] ?? 99,
                  (x) => x.name ?? x.id,
                ),
                map((x) => ({
                  label: x.name,
                  value: x.id,
                  hint: ({
                    navi: "recommended",
                    anthropic: "Claude Max or API key",
                    "claude-code": "Use Claude Code account auth",
                    openai: "ChatGPT Plus/Pro or API key",
                    "google-antigravity": "Gemini 3/2.5 & Claude 4.6/3.5 via Google OAuth",
                    "gemini-cli": "Run Gemini models via Google OAuth",
                    "qwen-code": "Run Qwen models via Qwen Device Flow",
                  } as Record<string, string | undefined>)[x.id],
                })),
              ),
              {
                value: "other",
                label: "Other",
              },
            ],
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          provider = result as string
        }

        if (!provider) throw new Error("Provider is required")

        const authProvider = resolveProviderForAuth(provider)

        let pluginAuth = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === authProvider)?.auth)

        // Built-in handlers for internal providers that aren't loaded as plugins
        if (!pluginAuth && authProvider === "google-antigravity") {
          const { AntigravityAuthHook } = await import("../../provider/antigravity")
          pluginAuth = AntigravityAuthHook
        }

        if (!pluginAuth && authProvider === "gemini-cli") {
          const { GeminiAuthHook } = await import("../../provider/gemini-cli")
          pluginAuth = GeminiAuthHook
        }

        if (!pluginAuth && authProvider === "qwen-cli") {
          const { QwenAuthHook } = await import("../../provider/qwen-cli")
          pluginAuth = QwenAuthHook
        }

        if (!pluginAuth && authProvider === "kilocode") {
          const { KilocodeAuthHook } = await import("../../provider/kilocode")
          pluginAuth = KilocodeAuthHook
        }

        if (!pluginAuth && authProvider === "cline") {
          const { ClineAuthHook } = await import("../../provider/cline-provider")
          pluginAuth = ClineAuthHook
        }

        if (!pluginAuth && authProvider === "roocode") {
          const { RoocodeAuthHook } = await import("../../provider/roocode-provider")
          pluginAuth = RoocodeAuthHook
        }

        if (pluginAuth) {
          const handled = await handlePluginAuth({ auth: pluginAuth }, authProvider)
          if (handled) return
        }

        if (provider === "other") {
          const result = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(result)) throw new UI.CancelledError()
          provider = (result as string).replace(/^@ai-sdk\//, "")

          // Check if a plugin provides auth for this custom provider
          const customPlugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider)
            if (handled) return
          }

          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in navi.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon Bedrock authentication priority:\n" +
            "  1. Bearer token (AWS_BEARER_TOKEN_BEDROCK or /connect)\n" +
            "  2. AWS credential chain (profile, access keys, IAM roles)\n\n" +
            "Configure via navi.json options (profile, region, endpoint) or\n" +
            "AWS environment variables (AWS_PROFILE, AWS_REGION, AWS_ACCESS_KEY_ID).",
          )
        }

        if (authProvider === "navi") {
          prompts.log.info("Create an api key at https://navi.ai/auth")
        }

        if (authProvider === "Navi") {
          prompts.log.info("Create an api key at https://Navi.ai/auth")
        }

        if (authProvider === "kilocode") {
          prompts.log.info("Create an api key at https://kilo.ai/auth")
        }

        if (authProvider === "cline") {
          prompts.log.info("Get your API key from your Cline account at https://cline.bot")
        }

        if (authProvider === "roocode") {
          prompts.log.info("Get your API key from your Roo Code account at https://roocode.com")
        }

        if (authProvider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        if (authProvider && ["cloudflare", "cloudflare-ai-gateway"].includes(authProvider)) {
          prompts.log.info(
            "Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: https://navi.ai/docs/providers/#cloudflare-ai-gateway",
          )
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await Auth.set(authProvider, {
          type: "api",
          key,
        })
          // Refresh provider state and fetch the latest models for this provider when enabled.
          await Provider.refreshProviderOnConnect(authProvider)

        prompts.outro("Done")
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})



