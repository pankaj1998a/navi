/**
 * Shared egress-policy guard for tool HTTP and browser helpers.
 *
 * The policy itself lives in `@/permission/network`. Web tools that run inside
 * an Effect (and therefore can read the active config) resolve the full policy
 * with {@link resolvePolicy}; plain async helpers called from those tools take
 * the resolved policy as an optional argument and fall back to the
 * environment-only policy when they are invoked outside an Effect context
 * (for example from the CLI).
 *
 * Redirects are never followed blindly: {@link guardedFetch} uses
 * `redirect: "manual"` and re-validates every hop before issuing it, so a
 * public host cannot bounce a request into a denied host or the private
 * network.
 *
 * @module @navi/tool/net-guard
 */

import { Effect, Option } from "effect"
import { Config } from "@/config/config"
import * as NetworkPolicy from "@/permission/network"

export type Policy = NetworkPolicy.NetworkPolicy

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

/**
 * Resolve the effective policy (config + env) from the active Config service.
 * Returns `undefined` when nothing is configured, which keeps the historical
 * allow-all behaviour.
 */
export const resolvePolicy = Effect.fnUntraced(function* () {
  const config = Option.getOrUndefined(yield* Effect.serviceOption(Config.Service))
  const permission = config ? (yield* config.get()).permission : undefined
  return NetworkPolicy.resolve(permission)
})

/**
 * Environment-only policy for helpers that run outside an Effect context.
 * Project `.env` values are already filtered out by
 * {@link NetworkPolicy.fromEnvironment}.
 */
export function environmentPolicy(): Policy | undefined {
  return NetworkPolicy.resolve(undefined)
}

/**
 * The policy actually enforced for a call. An explicitly resolved policy wins;
 * otherwise fall back to env so out-of-Effect callers still fail closed.
 */
export function effectivePolicy(policy?: Policy): Policy | undefined {
  return policy ?? environmentPolicy()
}

/** Throw `NetworkBlockedError` when the URL is not permitted. No-op without a policy. */
export function assertAllowed(url: string, policy?: Policy): void {
  NetworkPolicy.assertUrlAllowed(url, effectivePolicy(policy))
}

/** Non-throwing variant of {@link assertAllowed}. */
export function isAllowed(url: string, policy?: Policy): boolean {
  const effective = effectivePolicy(policy)
  if (!effective) return true
  return NetworkPolicy.urlAllowed(url, effective)
}

/** True when the error came from the egress policy. */
export function isNetworkBlocked(error: unknown): error is NetworkPolicy.NetworkBlockedError {
  return error instanceof NetworkPolicy.NetworkBlockedError
}

export interface GuardedFetchOptions extends Omit<RequestInit, "redirect"> {
  /** Resolved policy; falls back to the env-only policy when omitted. */
  policy?: Policy
  /** Maximum redirect hops to follow (each hop is re-validated). */
  maxRedirects?: number
}

/**
 * `fetch` that enforces the network policy on the initial URL and on every
 * redirect hop. Automatic redirects are disabled: a 3xx response is only
 * followed after its target passes the same policy check, so a denied or
 * private redirect target is blocked instead of being fetched.
 */
export async function guardedFetch(url: string, options: GuardedFetchOptions = {}): Promise<Response> {
  const { policy, maxRedirects = MAX_REDIRECTS, ...init } = options
  const effective = effectivePolicy(policy)

  let current = url
  let currentInit: RequestInit = init

  for (let hop = 0; ; hop++) {
    NetworkPolicy.assertUrlAllowed(current, effective)
    const response = await fetch(current, { ...currentInit, redirect: "manual" })

    if (!REDIRECT_STATUS.has(response.status)) return response

    const location = response.headers.get("location")
    if (!location) return response

    if (hop >= maxRedirects) {
      throw new Error(`Too many redirects while fetching ${url}`)
    }

    let next: string
    try {
      next = new URL(location, current).toString()
    } catch {
      throw new NetworkPolicy.NetworkBlockedError(`Unparseable redirect target: ${location}`, location)
    }

    // Re-validate before issuing the redirected request.
    NetworkPolicy.assertUrlAllowed(next, effective)

    const method = (currentInit.method ?? "GET").toUpperCase()
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
      currentInit = { ...currentInit, method: "GET", body: undefined }
    }

    current = next
  }
}

/**
 * Policy check for a request issued by the browser engine. Non-network schemes
 * (`data:`, `about:`, `blob:`) are not egress and always pass.
 */
export function browserRequestAllowed(rawUrl: string, policy?: Policy): boolean {
  const effective = effectivePolicy(policy)
  if (!effective) return true

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true
  return NetworkPolicy.urlAllowed(rawUrl, effective)
}

export * as NetGuard from "./net-guard"
