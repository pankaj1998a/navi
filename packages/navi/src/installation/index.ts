import { BusEvent } from "@/bus/bus-event"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { NamedError } from "@navi-ai/sdk/util/error"
import { Log } from "../util/log"
import { iife } from "@/util/iife"
import { Flag } from "../flag/flag"

declare global {
  const NAVI_VERSION: string
  const NAVI_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = Awaited<ReturnType<typeof method>>

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export async function method() {
    if (process.execPath.includes(path.join(".navi", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    try {
      if (exec.includes("npm") || exec.includes("node")) {
        const root = (await $`npm root -g`.quiet().nothrow().text()).trim()
        if (root && await Bun.file(path.join(root, "navi-ai-agent/package.json")).exists()) {
          return "npm"
        }
      }
    } catch { }

    try {
      if (exec.includes("bun")) {
        const root = (await $`bun pm bin -g`.quiet().nothrow().text()).trim()
        // bun pm bin -g returns the bin folder, not node_modules.
        // bun global installs are in specific location.
        // Fallback to checking existing slow method for bun if needed, or simple 'bun pm ls -g'
        const output = await $`bun pm ls -g`.quiet().nothrow().text()
        if (output.includes("navi-ai-agent")) return "bun"
      }
    } catch { }

    // Fallback to checking the binary path directly if we can't detect via manager
    // or just run the original checks but optimized?

    const checks = [
      {
        name: "npm" as const,
        // optimized npm check just in case
        command: async () => {
          const root = (await $`npm root -g`.quiet().nothrow().text()).trim()
          return (root && await Bun.file(path.join(root, "navi-ai-agent/package.json")).exists()) ? "navi-ai-agent" : ""
        }
      },
      {
        name: "yarn" as const,
        command: () => $`yarn global list`.throws(false).quiet().text(),
      },
      {
        name: "pnpm" as const,
        command: () => $`pnpm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "bun" as const,
        command: () => $`bun pm ls -g`.throws(false).quiet().text(),
      },
      {
        name: "brew" as const,
        command: () => $`brew list --formula navi`.throws(false).quiet().text(),
      },
    ]

    checks.sort((a, b) => {
      const aMatches = exec.includes(a.name)
      const bMatches = exec.includes(b.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    for (const check of checks) {
      // logic to skip checks if we already strongly suspect another one?
      // For now, just run them.
      const output = await check.command()
      if (output.includes(check.name === "brew" ? "navi" : "navi-ai-agent")) {
        return check.name
      }
    }

    return "unknown"
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  async function getBrewFormula() {
    const tapFormula = await $`brew list --formula pankaj/tap/navi`.throws(false).quiet().text()
    if (tapFormula.includes("navi")) return "pankaj/tap/navi"
    const coreFormula = await $`brew list --formula navi`.throws(false).quiet().text()
    if (coreFormula.includes("navi")) return "navi"
    return "navi"
  }

  export async function upgrade(method: Method, target: string) {
    let cmd
    switch (method) {
      case "curl":
        cmd = $`curl -fsSL https://navi.ai/install | bash`.env({
          ...process.env,
          VERSION: target,
        })
        break
      case "npm":
        cmd = $`npm install -g navi-ai-agent@${target}`
        break
      case "pnpm":
        cmd = $`pnpm install -g navi-ai-agent@${target}`
        break
      case "bun":
        cmd = $`bun install -g navi-ai-agent@${target}`
        break
      case "brew": {
        const formula = await getBrewFormula()
        cmd = $`brew upgrade ${formula}`.env({
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        })
        break
      }
      default:
        throw new Error(`Unknown method: ${method}`)
    }
    const result = await cmd.quiet().throws(false)
    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    if (result.exitCode !== 0)
      throw new UpgradeFailedError({
        stderr: result.stderr.toString("utf8"),
      })
    await $`${process.execPath} --version`.nothrow().quiet().text()
  }

  export const VERSION = typeof NAVI_VERSION === "string" ? NAVI_VERSION : "local"
  export const CHANNEL = typeof NAVI_CHANNEL === "string" ? NAVI_CHANNEL : "local"
  export const USER_AGENT = `navi/${CHANNEL}/${VERSION}/${Flag.NAVI_CLIENT}`

  export async function latest(installMethod?: Method) {
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula === "navi") {
        return fetch("https://formulae.brew.sh/api/formula/navi.json")
          .then((res) => {
            if (!res.ok) throw new Error(res.statusText)
            return res.json()
          })
          .then((data: any) => data.versions.stable)
          .catch((err) => {
            log.warn("failed to check brew version", { error: err })
            return "local"
          })
      }
    }

    if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
      const registry = await iife(async () => {
        try {
          const r = (await $`npm config get registry`.quiet().nothrow().text()).trim()
          const reg = r || "https://registry.npmjs.org"
          return reg.endsWith("/") ? reg.slice(0, -1) : reg
        } catch {
          return "https://registry.npmjs.org"
        }
      })
      const channel = CHANNEL === "local" || CHANNEL === "main" ? "latest" : CHANNEL
      const url = `${registry}/navi-ai-agent`

      return fetch(url, {
        headers: {
          Accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*",
        },
      })
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) return null
            throw new Error(`${res.status} ${res.statusText}`)
          }
          return res.json()
        })
        .then((data: any) => {
          if (!data) return "local"
          const distTags = data["dist-tags"] || {}
          return distTags[channel] || distTags["latest"] || "local"
        })
        .catch((err) => {
          // excessive logging here might break TUI if printed to stdout/stderr directly
          // log.warn("failed to check npm version", { error: err, url })
          return "local"
        })
    }

    return fetch("https://api.github.com/repos/pankaj/navi/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
      .catch(() => "local")
  }
}

