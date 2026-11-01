/**
 * Navi Hook Runner
 *
 * Executes hooks for a given lifecycle event.
 * Supports: shell command hooks, HTTP webhooks, function hooks.
 *
 * Hook output JSON schema:
 * {
 *   "continue": boolean,          // false = block operation
 *   "additionalContext": string,  // inject into system prompt
 *   "systemMessage": string,      // show in TUI
 *   "blockReason": string         // reason when continue=false
 * }
 */

import { spawn } from "child_process"
import dns from "node:dns/promises"
import net from "node:net"
import { Log } from "@navi-ai/core/util/log"
import { scrubEnvironment } from "@/sandbox"
import { validateTargetUrl } from "@/security/url-safety"
import { isPrivateIP } from "@/util/ssrf"
import type {
  HookEvent,
  HookInput,
  HookOutput,
  Hook,
  CommandHook,
  HttpHook,
  FunctionHook,
} from "./types"

const log = Log.create({ service: "hook-runner" })

const DEFAULT_HOOK_TIMEOUT_MS = 30_000

// ─── Environment Scrubbing ────────────────────────────────────────────────────

/**
 * Variables a command hook legitimately needs to find its interpreter and
 * write to temp dirs. Everything else (API keys, tokens, credentials, cloud
 * config, `NAVI_*` auth material) is dropped so a malicious project hook
 * cannot exfiltrate the user's secrets.
 */
const HOOK_ENV_ALLOW = new Set(
  [
    "PATH",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "TEMP",
    "TMP",
    "TMPDIR",
    "SHELL",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "OS",
    "USER",
    "USERNAME",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TERM",
    "PWD",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
  ].map((key) => key.toUpperCase()),
)

const SECRET_ENV = /API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY|AUTH|COOKIE|SESSION/i

/**
 * Build the environment for a command hook: loader-variable scrubbing plus an
 * allowlist of OS essentials and a hard deny for credential-shaped names.
 */
export function scrubHookEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(scrubEnvironment(env))) {
    if (SECRET_ENV.test(key)) continue
    if (!HOOK_ENV_ALLOW.has(key.toUpperCase())) continue
    out[key] = value
  }
  return out
}

export type RunHookOptions = {
  /**
   * Allow HTTP hooks to target loopback / private / link-local addresses.
   * Off by default so a project hook cannot reach local admin endpoints or
   * cloud metadata services. User-controlled config/env can opt in.
   */
  readonly allowPrivateNetwork?: boolean
}

// ─── Shell Command Hook ───────────────────────────────────────────────────────

async function runCommandHook(hook: CommandHook, input: HookInput): Promise<HookOutput | null> {
  const timeout = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS
  const jsonInput = JSON.stringify(input)

  return new Promise<HookOutput | null>((resolve) => {
    let stdout = ""
    let stderr = ""

    const proc = spawn("bash", ["-c", hook.command], {
      cwd: input.cwd,
      env: {
        ...scrubHookEnvironment(),
        NAVI_HOOK_EVENT: input.event,
        NAVI_SESSION_ID: input.sessionID,
        NAVI_TOOL: input.tool ?? "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    proc.stdin?.write(jsonInput)
    proc.stdin?.end()

    proc.stdout?.setEncoding("utf8")
    proc.stderr?.setEncoding("utf8")
    proc.stdout?.on("data", (chunk: string) => { stdout += chunk })
    proc.stderr?.on("data", (chunk: string) => { stderr += chunk })

    const timer = setTimeout(() => {
      proc.kill()
      log.warn("hook timed out", { command: hook.command, timeout })
      resolve(null)
    }, timeout)

    proc.once("close", (code) => {
      clearTimeout(timer)
      log.info("command hook completed", { command: hook.command, code, stderr: stderr.slice(0, 200) })

      const trimmed = stdout.trim()
      if (!trimmed) {
        resolve(null)
        return
      }

      try {
        const parsed = JSON.parse(trimmed) as HookOutput
        resolve(parsed)
      } catch {
        // Non-JSON output is treated as informational only
        log.info("hook output (non-JSON)", { output: trimmed.slice(0, 500) })
        resolve(null)
      }
    })

    proc.once("error", (err) => {
      clearTimeout(timer)
      log.error("command hook error", { command: hook.command, err })
      resolve(null)
    })
  })
}

// ─── HTTP Webhook Hook ────────────────────────────────────────────────────────

/** DNS resolver seam so tests can simulate rebinding answers without network. */
export type HookDnsLookup = (hostname: string) => Promise<readonly { address: string; family: number }[]>

const defaultLookup: HookDnsLookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true })

export type ResolvedHookTarget = {
  /** URL to fetch. For http targets this is the validated IP literal (pinned). */
  fetchUrl: string
  /** Original host[:port], sent as `Host` when fetching a pinned IP literal. */
  hostHeader?: string
  hostname: string
  addresses: string[]
}

export type HookTargetResolution = { ok: true; target: ResolvedHookTarget } | { ok: false; reason: string }

/**
 * Resolve an HTTP hook target and decide what to fetch.
 *
 * DNS-rebinding TOCTOU: validating a hostname and then fetching it by name
 * leaves a window where the resolver can answer with a private address on the
 * second lookup. Mitigations here:
 *
 *  - resolve every A/AAAA answer and fail closed if ANY of them is
 *    private/loopback/link-local/metadata (this also rejects hostnames that mix
 *    public and private answers), and
 *  - for `http:` targets, fetch the validated IP literal and restore the
 *    original vhost via a `Host` header, so no second DNS lookup can change the
 *    destination.
 *
 * Residual risk (documented, not fixed): Bun's `fetch` derives TLS SNI and the
 * certificate check from the URL host, and exposes no SNI/serverName override,
 * so `https:` targets cannot be pinned to an IP. For those the OS resolver is
 * consulted again at connect time and a rebinding DNS server can still win the
 * race. HTTPS hooks therefore rely on the all-addresses check above plus the
 * operator's DNS.
 */
export async function resolveHookTarget(
  rawUrl: string,
  lookup: HookDnsLookup = defaultLookup,
): Promise<HookTargetResolution> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: `unparseable URL: ${rawUrl}` }
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, reason: `blocked protocol: ${protocol}. Only http: and https: are allowed` }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (!hostname) return { ok: false, reason: "missing hostname" }

  // IP literal: the resolver is not involved, but the address must be public.
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      return { ok: false, reason: `direct private/reserved IP address: ${hostname}` }
    }
    return { ok: true, target: { fetchUrl: parsed.toString(), hostname, addresses: [hostname] } }
  }

  let addresses: string[]
  try {
    const records = await lookup(hostname)
    addresses = records.map((record) => record.address)
  } catch (err) {
    // Fail closed: an unresolvable host is never fetched.
    return { ok: false, reason: `DNS resolution failed for ${hostname}: ${(err as Error)?.message ?? String(err)}` }
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `DNS resolution returned no records for ${hostname}` }
  }

  const unsafe = addresses.find((address) => isPrivateIP(address))
  if (unsafe) {
    return {
      ok: false,
      reason: `DNS rebinding blocked: ${hostname} resolves to private/internal address ${unsafe}`,
    }
  }

  // Pin plain-HTTP requests to the validated address. `parsed.pathname` is
  // always at least "/" for http(s) URLs.
  if (protocol === "http:") {
    const address = addresses[0]!
    const literal = net.isIPv6(address) ? `[${address}]` : address
    const port = parsed.port ? `:${parsed.port}` : ""
    return {
      ok: true,
      target: {
        fetchUrl: `http://${literal}${port}${parsed.pathname}${parsed.search}`,
        hostHeader: parsed.host,
        hostname,
        addresses,
      },
    }
  }

  return { ok: true, target: { fetchUrl: parsed.toString(), hostname, addresses } }
}

async function runHttpHook(
  hook: HttpHook,
  input: HookInput,
  options?: RunHookOptions,
): Promise<HookOutput | null> {
  // HTTP hooks are attacker-reachable URLs from project config: reject
  // non-http(s), embedded credentials, numeric-obfuscated hosts, and
  // loopback/private/link-local targets before issuing the request.
  const safety = validateTargetUrl(hook.url, { allowLocalhost: options?.allowPrivateNetwork })
  if (!safety.safe) {
    log.warn("http hook blocked by URL safety policy", { url: hook.url, reason: safety.reason })
    return null
  }

  // The static check above cannot see DNS: a public-looking name may resolve to
  // loopback or a cloud metadata address. Resolve every address (fail closed)
  // and pin http targets to the validated IP unless the user explicitly allowed
  // private targets.
  let fetchUrl = hook.url
  let hostHeader: string | undefined
  if (!options?.allowPrivateNetwork) {
    const resolution = await resolveHookTarget(hook.url)
    if (!resolution.ok) {
      log.warn("http hook blocked: unsafe or unresolvable target", { url: hook.url, reason: resolution.reason })
      return null
    }
    fetchUrl = resolution.target.fetchUrl
    hostHeader = resolution.target.hostHeader
  }

  const timeout = hook.timeout ?? DEFAULT_HOOK_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    // Never follow redirects: the validated URL is the only target the user
    // approved, and an open redirect on a public host would otherwise bounce
    // the request into the private network (SSRF).
    const response = await fetch(fetchUrl, {
      method: hook.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...hook.headers,
        // Pinned-IP fetch: restore the vhost that was validated. Set last so a
        // hook config cannot redirect the Host header elsewhere.
        ...(hostHeader ? { Host: hostHeader } : {}),
      },
      body: JSON.stringify(input),
      redirect: "manual",
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (response.status >= 300 && response.status < 400) {
      log.warn("http hook redirect refused", {
        url: hook.url,
        status: response.status,
        location: response.headers.get("location"),
      })
      return null
    }

    if (!response.ok) {
      log.warn("http hook returned non-2xx", { url: hook.url, status: response.status })
      return null
    }

    const text = await response.text()
    if (!text.trim()) return null

    const parsed = JSON.parse(text) as HookOutput
    return parsed
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === "AbortError") {
      log.warn("http hook timed out", { url: hook.url, timeout })
    } else {
      log.error("http hook error", { url: hook.url, err })
    }
    return null
  }
}

// ─── Function Hook ────────────────────────────────────────────────────────────

async function runFunctionHook(hook: FunctionHook, input: HookInput): Promise<HookOutput | null> {
  try {
    const result = await hook.fn(input)
    return result ?? null
  } catch (err) {
    log.error("function hook error", { id: hook.id, err })
    return null
  }
}

// ─── Aggregated Result ────────────────────────────────────────────────────────

export type AggregatedHookResult = {
  /** Whether to continue the operation */
  shouldContinue: boolean
  /** Block reason (if blocked) */
  blockReason?: string
  /** Additional contexts from all hooks, merged */
  additionalContexts: string[]
  /** System messages from all hooks */
  systemMessages: string[]
}

// ─── Main Runner ──────────────────────────────────────────────────────────────

/**
 * Execute a single hook and return its output.
 */
export async function runHook(hook: Hook, input: HookInput, options?: RunHookOptions): Promise<HookOutput | null> {
  log.info("running hook", { type: hook.type, event: input.event })

  if (hook.type === "command") {
    // Apply tool filter if present
    if (hook.toolFilter && hook.toolFilter !== "*" && hook.toolFilter !== input.tool) {
      return null
    }
    return runCommandHook(hook, input)
  }

  if (hook.type === "http") {
    if (hook.toolFilter && hook.toolFilter !== "*" && hook.toolFilter !== input.tool) {
      return null
    }
    return runHttpHook(hook, input, options)
  }

  if (hook.type === "function") {
    return runFunctionHook(hook, input)
  }

  return null
}

/**
 * Execute all hooks for a given event and aggregate results.
 * Hooks run in parallel; if ANY hook blocks, the operation is blocked.
 */
export async function runHooks(
  hooks: Hook[],
  input: HookInput,
  options?: RunHookOptions,
): Promise<AggregatedHookResult> {
  const results = await Promise.allSettled(hooks.map((hook) => runHook(hook, input, options)))

  const aggregated: AggregatedHookResult = {
    shouldContinue: true,
    additionalContexts: [],
    systemMessages: [],
  }

  for (const result of results) {
    if (result.status === "rejected") {
      log.error("hook execution rejected", { reason: result.reason })
      continue
    }

    const output = result.value
    if (!output) continue

    // A hook blocks either explicitly (`continue: false`) or by supplying a
    // `blockReason`; a reason without a flag is still a block request.
    if (output.continue === false || output.blockReason) {
      aggregated.shouldContinue = false
      if (output.blockReason) aggregated.blockReason = output.blockReason
    }

    if (output.additionalContext) {
      aggregated.additionalContexts.push(output.additionalContext)
    }

    if (output.systemMessage) {
      aggregated.systemMessages.push(output.systemMessage)
    }
  }

  return aggregated
}
