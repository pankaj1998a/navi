import { Effect } from "effect"
import { Server } from "../../server/server"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@navi-ai/core/flag/flag"
import { isNativeWebAvailable, startNativeWebServer } from "../../native/web-runner"
import open from "open"
import { networkInterfaces } from "os"

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    for (const netInfo of net) {
      // Skip internal and non-IPv4 addresses
      if (netInfo.internal || netInfo.family !== "IPv4") continue

      // Skip Docker bridge networks (typically 172.x.x.x)
      if (netInfo.address.startsWith("172.")) continue

      results.push(netInfo.address)
    }
  }

  return results
}

export const WebCommand = effectCmd({
  command: "web",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start navi server and open web interface",
  // Server loads instances per-request via x-navi-directory header — no
  // ambient project InstanceContext needed at startup.
  instance: false,
  handler: Effect.fn("Cli.web")(function* (args) {
    const opts = yield* resolveNetworkOptions(args)
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    // 1. If explicitly requested via --engine rust, start native Rust web server
    if (process.argv.includes("--rust") || process.env.NAVI_WEB_ENGINE === "rust") {
      const nativeServer = yield* Effect.promise(() =>
        startNativeWebServer({
          port: opts.port,
          hostname: opts.hostname,
          password: Flag.NAVI_SERVER_PASSWORD || process.env.NAVI_SERVER_PASSWORD,
          noAuth: process.env.NAVI_DISABLE_SERVER_AUTH === "1" || Flag.NAVI_SERVER_PASSWORD === "",
        }),
      )

      UI.println(UI.Style.TEXT_INFO_BOLD + "  Engine:            ", UI.Style.TEXT_NORMAL, "Native Rust (Axum + ConPTY)")
      if (nativeServer.password) {
        UI.println(UI.Style.TEXT_INFO_BOLD + "  Username:          ", UI.Style.TEXT_NORMAL, nativeServer.username ?? "navi")
        UI.println(UI.Style.TEXT_INFO_BOLD + "  Password:          ", UI.Style.TEXT_NORMAL, nativeServer.password)
      } else {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "!  Authentication disabled; server is unsecured.")
      }
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, nativeServer.url)

      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0 && opts.hostname === "0.0.0.0") {
        for (const ip of networkIPs) {
          UI.println(
            UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
            UI.Style.TEXT_NORMAL,
            `http://${ip}:${nativeServer.port}`,
          )
        }
      }

      open(nativeServer.authenticatedUrl).catch(() => {})
      yield* Effect.never
    }

    // 2. Fallback to TypeScript/Effect-TS server
    const server = yield* Effect.promise(() => Server.listen(opts))
    const username = Flag.NAVI_SERVER_USERNAME || process.env.NAVI_SERVER_USERNAME || "navi"
    const password = server.password
    const authQuery = password
      ? `?auth_token=${encodeURIComponent(Buffer.from(`${username}:${password}`).toString("base64"))}`
      : ""

    if (password) {
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Username:          ", UI.Style.TEXT_NORMAL, username)
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Password:          ", UI.Style.TEXT_NORMAL, password)
    } else {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  Authentication disabled; server is unsecured.")
    }

    if (opts.hostname === "0.0.0.0") {
      // Show localhost for local access
      const localhostUrl = `http://localhost:${server.port}`
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, localhostUrl)

      // Show network IPs for remote access
      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0) {
        for (const ip of networkIPs) {
          UI.println(
            UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
            UI.Style.TEXT_NORMAL,
            `http://${ip}:${server.port}`,
          )
        }
      }

      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `${opts.mdnsDomain}:${server.port}`,
        )
      }

      // Open localhost in browser with authentication token
      open(`${localhostUrl}${authQuery}`).catch(() => {})
    } else {
      const displayUrl = server.url.toString().replace(/\/$/, "")
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:     ", UI.Style.TEXT_NORMAL, displayUrl)
      open(`${displayUrl}${authQuery}`).catch(() => {})
    }

    yield* Effect.never
  }),
})
