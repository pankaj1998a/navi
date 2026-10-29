import { EOL } from "os"
import { cmd } from "./cmd"
import { UI } from "@/cli/ui"
import { ServerAuth } from "@/server/auth"

const methods = new Set(["delete", "get", "head", "options", "patch", "post", "put"])

const DEFAULT_SERVER_URL = "http://127.0.0.1:4096"
const TIMEOUT_MS = 30_000

export const ApiCommand = cmd({
  command: "api <method> <path>",
  describe: "make a request to a running navi server",
  builder: (yargs) =>
    yargs
      .positional("method", {
        type: "string",
        describe: "HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)",
        demandOption: true,
      })
      .positional("path", {
        type: "string",
        describe: "server path, e.g. /global/health",
        demandOption: true,
      })
      .option("data", {
        alias: ["d"],
        type: "string",
        describe: "request body",
      })
      .option("header", {
        alias: ["H"],
        type: "string",
        array: true,
        default: [] as string[],
        describe: "request header in Name:Value form (repeatable)",
      })
      .option("param", {
        type: "string",
        array: true,
        default: [] as string[],
        describe: "query parameter as key=value (repeatable)",
      })
      .option("server", {
        type: "string",
        describe: "server URL (defaults to NAVI_SERVER_URL or a probed local server)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to NAVI_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to NAVI_SERVER_USERNAME or 'navi')",
      }),
  handler: async (args) => {
    const method = (args.method ?? "").toLowerCase()
    if (!methods.has(method)) {
      UI.error(`Invalid method, expected one of ${[...methods].join(", ").toUpperCase()}: ${args.method}`)
      process.exit(1)
    }
    const path = args.path ?? ""
    if (!path.startsWith("/")) {
      UI.error(`Invalid path, expected a server path starting with "/": ${path}`)
      process.exit(1)
    }

    const base = await resolveServer(args.server)
    if (!base) {
      UI.error("No navi server found. Start one with `navi serve` or pass --server <url>.")
      process.exit(1)
    }

    let url: URL
    try {
      url = new URL(withQuery(path, args.param ?? []), base)
    } catch (err) {
      UI.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
    const headers = new Headers(ServerAuth.headers({ password: args.password, username: args.username }))
    for (const header of args.header ?? []) {
      const index = header.indexOf(":")
      if (index < 1) {
        UI.error(`Invalid header, expected Name:Value: ${header}`)
        process.exit(1)
      }
      headers.set(header.slice(0, index).trim(), header.slice(index + 1).trim())
    }
    const body = args.data
    if (body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")

    let response: Response
    try {
      response = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      UI.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
    const output = await response.text()
    if (output) process.stdout.write(output + (output.endsWith(EOL) ? "" : EOL))
    if (!response.ok) {
      process.stderr.write(`HTTP ${response.status} ${response.statusText}${EOL}`)
      process.exitCode = 1
    }
  },
})

function withQuery(path: string, params: string[]) {
  if (params.length === 0) return path
  const [pathname, existing] = path.split("?", 2)
  const query = new URLSearchParams(existing ?? "")
  for (const param of params) {
    const index = param.indexOf("=")
    if (index < 0) throw new Error(`Invalid param, expected key=value: ${param}`)
    query.append(param.slice(0, index), param.slice(index + 1))
  }
  const suffix = query.toString()
  return suffix ? `${pathname}?${suffix}` : (pathname ?? path)
}

async function resolveServer(flag: string | undefined) {
  if (flag) return normalize(flag)
  const env = process.env.NAVI_SERVER_URL
  if (env) return normalize(env)
  try {
    const probe = await fetch(new URL("/global/health", DEFAULT_SERVER_URL), {
      signal: AbortSignal.timeout(2000),
    })
    // Any HTTP response (even 401) proves a navi server is listening.
    if (probe.status > 0) return DEFAULT_SERVER_URL
    return undefined
  } catch {
    return undefined
  }
}

function normalize(url: string) {
  return url.replace(/\/+$/, "")
}
