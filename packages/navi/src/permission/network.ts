/**
 * Network egress policy helpers.
 *
 * Kept as a pure module so fetch/web tools can adopt it without coupling to a
 * specific HTTP client. Policies are resolved from `permission.network` in the
 * user config and/or the `NAVI_NETWORK_ALLOW` / `NAVI_NETWORK_DENY` env vars.
 *
 * Semantics:
 * - No policy configured at all: every host is allowed (backwards compatible).
 * - Any policy configured: deny by default, unless an `allow` entry matches.
 * - `deny` always wins over `allow`.
 *
 * Config shape (navi.json):
 * ```json
 * { "permission": { "network": { "api.example.com": "allow", "*.corp": "deny" } } }
 * ```
 *
 * @module @navi/permission/network
 */

import * as Log from "@navi-ai/core/util/log"
import fs from "node:fs"
import path from "node:path"

const log = Log.create({ service: "network-policy" })

let envFileCache: { cwd: string; keys: ReadonlySet<string> } | undefined

/**
 * Names of variables defined by `.env*` files in `cwd`.
 *
 * Bun auto-loads `.env`, `.env.local` and `.env.${NODE_ENV}` from the working
 * directory. When navi is started inside a repository those values are
 * attacker-controlled, so policy switches read from the environment must not
 * treat them as an explicit user opt-in. Example/sample/template files are not
 * loaded by Bun and are ignored here.
 */
export function environmentFileKeys(cwd: string = process.cwd()): ReadonlySet<string> {
  if (envFileCache?.cwd === cwd) return envFileCache.keys

  const keys = new Set<string>()
  try {
    for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
      if (entry.isDirectory()) continue
      if (!entry.name.startsWith(".env")) continue
      if (/example|sample|template|defaults/i.test(entry.name)) continue
      let text: string
      try {
        text = fs.readFileSync(path.join(cwd, entry.name), "utf8")
      } catch {
        continue
      }
      for (const line of text.split(/\r?\n/)) {
        const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
        if (match) keys.add(match[1]!.toUpperCase())
      }
    }
  } catch {
    // Unreadable cwd: nothing can be attributed to a loaded env file.
  }

  envFileCache = { cwd, keys }
  return keys
}

export interface NetworkPolicy {
  /** When non-empty, hosts must match at least one entry. */
  readonly allow?: ReadonlyArray<string>
  /** Always wins over the allowlist. */
  readonly deny?: ReadonlyArray<string>
  /**
   * Fallback when neither list matches. `deny` makes the policy deny-by-default,
   * which is what config/env-resolved policies use. Omitted means allow.
   */
  readonly default?: "allow" | "deny"
}

/** Raised when an outbound URL is refused by the configured egress policy. */
export class NetworkBlockedError extends Error {
  readonly _tag = "NetworkBlockedError"
  constructor(
    message: string,
    readonly url?: string,
  ) {
    super(`NETWORK_BLOCKED: ${message}`)
    this.name = "NetworkBlockedError"
  }
}

/**
 * Canonicalize a hostname: lowercase, strip trailing dots, and convert IDN
 * labels to punycode so a `deny` rule written as `пример.рф` also matches the
 * same host sent as `xn--e1afmkfd.xn--p1ai`. Bracketed IPv6 literals are
 * unwrapped.
 */
function canonicalHost(host: string): string {
  const value = host.trim().toLowerCase().replace(/\.+$/, "")
  if (!value) return value
  try {
    return new URL(`http://${value}`).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "")
  } catch {
    // Bare IPv6 literals (or otherwise unparseable input) pass through; the
    // caller still compares them verbatim.
    return value.replace(/^\[|\]$/g, "")
  }
}

/**
 * Match a hostname against an allowlist pattern. Supported forms:
 * - exact host: `api.example.com`
 * - subdomain wildcard: `*.example.com` (matches `api.example.com` and
 *   `a.b.example.com`, but not the apex `example.com`)
 *
 * Matching is case-insensitive and IDN rules are compared in punycode.
 */
export function matchHost(host: string, pattern: string): boolean {
  const target = normalizeHost(host)
  const raw = pattern.trim().replace(/\.+$/, "")
  const rule = raw.startsWith("*.") ? `*.${canonicalHost(raw.slice(2))}` : canonicalHost(raw)
  if (!target || !rule) return false
  if (rule === "*") return true

  if (rule.startsWith("*.")) {
    const suffix = rule.slice(1) // ".example.com"
    if (suffix.length <= 1) return false
    return target.endsWith(suffix) && target.length > suffix.length
  }

  return target === rule
}

/**
 * Normalize a hostname or URL into a bare lowercase hostname. Bracketed IPv6
 * literals are unwrapped and trailing root dots are dropped. Returns
 * `undefined` when the input is empty.
 */
export function normalizeHost(input: string): string | undefined {
  const value = input.trim()
  if (!value) return undefined

  if (value.includes("://")) {
    try {
      return canonicalHost(new URL(value).hostname)
    } catch {
      return undefined
    }
  }

  // `host:port` without a scheme. Leave bare IPv6 literals untouched.
  const withoutPath = value.split("/")[0]!
  const withoutPort =
    withoutPath.startsWith("[") || withoutPath.split(":").length === 2
      ? withoutPath.replace(/:\d+$/, "")
      : withoutPath
  return canonicalHost(withoutPort) || undefined
}

export function hostAllowed(host: string, policy: NetworkPolicy): boolean {
  const target = normalizeHost(host)
  if (!target) return false

  if (policy.deny?.some((pattern) => matchHost(target, pattern))) return false

  const allow = policy.allow ?? []
  if (allow.length > 0) return allow.some((pattern) => matchHost(target, pattern))

  // Empty allowlist: `default: "deny"` policies fail closed, legacy policies
  // (no `default`) keep the historical allow-all-except-denied behaviour.
  return policy.default !== "deny"
}

/**
 * Check whether an absolute URL is permitted by the policy. Relative or
 * unparseable URLs are rejected (fail closed).
 */
export function urlAllowed(url: string, policy: NetworkPolicy): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  return hostAllowed(parsed.hostname, policy)
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const items = value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

/**
 * Read `permission.network` (host -> action). A mapping with only `allow`
 * entries still denies every host not listed. Unknown actions are ignored;
 * `deny` entries always block.
 */
export function fromConfig(permission: unknown): NetworkPolicy | undefined {
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) return undefined
  const network = (permission as Record<string, unknown>).network
  if (!network || typeof network !== "object" || Array.isArray(network)) return undefined

  const allow: string[] = []
  const deny: string[] = []
  for (const [host, action] of Object.entries(network as Record<string, unknown>)) {
    if (typeof host !== "string" || !host.trim()) continue
    if (action === "allow") allow.push(host)
    else if (action === "deny") deny.push(host)
  }
  if (allow.length === 0 && deny.length === 0) return undefined
  return { allow, deny, default: "deny" }
}

/** Read the `NAVI_NETWORK_ALLOW` / `NAVI_NETWORK_DENY` env overrides. */
export function fromEnvironment(env: NodeJS.ProcessEnv = process.env): NetworkPolicy | undefined {
  let allow = splitList(env.NAVI_NETWORK_ALLOW)
  let deny = splitList(env.NAVI_NETWORK_DENY)

  // A value that came from a project `.env` file is repo-controlled, not a user
  // opt-in: ignore the tainted override instead of widening the policy.
  if (env === process.env) {
    const fromFiles = environmentFileKeys()
    if (fromFiles.has("NAVI_NETWORK_ALLOW")) allow = undefined
    if (fromFiles.has("NAVI_NETWORK_DENY")) deny = undefined
  }

  if (!allow && !deny) return undefined
  return { allow, deny, default: "deny" }
}

/**
 * Resolve the effective policy. Config and env entries are unioned; `deny`
 * still wins. Returns `undefined` when no policy is configured (allow all).
 */
export function resolve(permission?: unknown, env: NodeJS.ProcessEnv = process.env): NetworkPolicy | undefined {
  const config = fromConfig(permission)
  const environment = fromEnvironment(env)
  if (!config) return environment
  if (!environment) return config
  return {
    allow: [...(config.allow ?? []), ...(environment.allow ?? [])],
    deny: [...(config.deny ?? []), ...(environment.deny ?? [])],
    default: "deny",
  }
}

/**
 * Enforce the policy for an outbound URL. Throws `NetworkBlockedError` for
 * disallowed hosts and for non-http(s) URLs. No-op when no policy is resolved.
 */
export function assertUrlAllowed(url: string, policy?: NetworkPolicy): void {
  if (!policy) return

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new NetworkBlockedError(`Unparseable URL: ${url}`, url)
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new NetworkBlockedError(`Protocol '${parsed.protocol}' is not allowed`, url)
  }

  if (!hostAllowed(parsed.hostname, policy)) {
    log.warn("blocked outbound request", { url, host: parsed.hostname })
    throw new NetworkBlockedError(`Host '${parsed.hostname}' is not allowed by the network policy`, url)
  }
}

export * as NetworkPolicyModule from "./network"
