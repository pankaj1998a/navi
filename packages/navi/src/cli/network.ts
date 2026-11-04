import { Flag } from "@navi-ai/core/flag/flag"
import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "@/config/config"
import { Effect } from "effect"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  "mdns-domain": {
    type: "string" as const,
    describe: "custom domain name for mDNS service (default: navi.local)",
    default: "navi.local",
  },
  password: {
    type: "string" as const,
    describe: "password to authenticate against the server",
  },
  auth: {
    type: "boolean" as const,
    hidden: true,
  },
  "no-auth": {
    type: "boolean" as const,
    describe: "disable password authentication",
    default: false,
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}
export const resolveNetworkOptions = Effect.fn("Cli.resolveNetworkOptions")(function* (args: NetworkOptions) {
  const config = yield* Config.Service.use((cfg) => cfg.getGlobal())
  return resolveNetworkOptionsNoConfig(args, config)
})

export function resolveNetworkOptionsNoConfig(args: NetworkOptions, config?: Config.Info) {
  const noAuthExplicitlySet = process.argv.includes("--no-auth") || args.auth === false
  const passwordExplicitlySet = process.argv.includes("--password")
  if (noAuthExplicitlySet || args["no-auth"] || args.auth === false) {
    Flag.NAVI_SERVER_PASSWORD = ""
    process.env.NAVI_SERVER_PASSWORD = ""
    process.env.NAVI_DISABLE_SERVER_AUTH = "1"
  } else if (passwordExplicitlySet && args.password !== undefined) {
    Flag.NAVI_SERVER_PASSWORD = args.password
    process.env.NAVI_SERVER_PASSWORD = args.password
  }

  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const mdnsDomainExplicitlySet = process.argv.includes("--mdns-domain")
  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, mdnsDomain, cors }
}
