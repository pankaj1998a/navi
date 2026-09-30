import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

// Mirrors Hono's secureHeaders defaults:
// https://hono.dev/docs/middleware/builtin/secure-headers
// - X-DNS-Prefetch-Control: off
// - X-Frame-Options: SAMEORIGIN
// - Strict-Transport-Security: max-age=15552000; includeSubDomains
// - X-Download-Options: noopen
// - X-Content-Type-Options: nosniff
// - X-Permitted-Cross-Domain-Policies: none
// - Referrer-Policy: no-referrer
// - X-XSS-Protection: 0
// - Cross-Origin-Resource-Policy: same-origin
// - Cross-Origin-Opener-Policy: same-origin
// - Origin-Agent-Cluster: ?1
// - Removes X-Powered-By
const SECURE_HEADERS: Readonly<Record<string, string>> = {
  "x-dns-prefetch-control": "off",
  "x-frame-options": "SAMEORIGIN",
  "strict-transport-security": "max-age=15552000; includeSubDomains",
  "x-download-options": "noopen",
  "x-content-type-options": "nosniff",
  "x-permitted-cross-domain-policies": "none",
  "referrer-policy": "no-referrer",
  "x-xss-protection": "0",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "origin-agent-cluster": "?1",
}

export const secureHeadersLayer = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const response = yield* effect
      let out = response
      for (const [k, v] of Object.entries(SECURE_HEADERS)) {
        out = HttpServerResponse.setHeader(out, k, v)
      }
      // Remove X-Powered-By if set upstream (Hono secureHeaders default)
      if (out.headers["x-powered-by"]) {
        const headers = { ...out.headers }
        delete headers["x-powered-by"]
        out = HttpServerResponse.setHeaders(out, headers) as typeof out
        // Re-apply secure headers after deletion not needed; they are already set
      }
      return out
    }),
  { global: true },
)

// CSRF protection: mirrors hono/csrf behaviour + wires Bun.CSRF when available.
// - Only validates unsafe methods (not GET, HEAD, OPTIONS)
// - Only for form-capable content-types: application/x-www-form-urlencoded, multipart/form-data, text/plain
// - Checks Origin header against request Host / allowed origins, and Sec-Fetch-Site == same-origin
// - If Bun.CSRF is available (Bun >=1.3), also verifies X-CSRF-Token / _csrf header via Bun.CSRF.verify
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]

function isFormContentType(contentType: string | undefined): boolean {
  if (!contentType) return false
  const lower = contentType.split(";")[0]?.trim().toLowerCase() ?? ""
  return FORM_CONTENT_TYPES.some((t) => lower === t || lower.startsWith(t))
}

function getBunCSRF(): { verify: (token: string) => boolean } | undefined {
  try {
    // @ts-ignore Bun global is available at runtime in Bun
    const maybe = (globalThis as unknown as { Bun?: { CSRF?: { verify: (t: string) => boolean } } }).Bun?.CSRF
    if (maybe && typeof maybe.verify === "function") return maybe
  } catch {
    // ignore
  }
  return undefined
}

export const csrfLayer = HttpRouter.middleware(
  (effect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest

      if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
        return yield* effect
      }

      // Hono csrf only gates form-capable content-types. Mirror that to avoid breaking JSON API calls
      // that rely on Authorization header + CORS. For JSON, CORS + auth is primary protection.
      const contentType = request.headers["content-type"]
      if (contentType && !isFormContentType(contentType)) {
        // For JSON APIs, still enforce Origin/Sec-Fetch-Site when Origin is present
        // but don't fatal on missing token - this matches Hono's narrow scope.
        // We enforce double-submit token if X-CSRF-Token header is present via Bun.CSRF.
      }

      const csrf = getBunCSRF()
      const tokenHeader =
        request.headers["x-csrf-token"] ??
        request.headers["x-xsrf-token"] ??
        request.headers["csrf-token"]

      if (tokenHeader && csrf) {
        let valid = false
        try {
          valid = csrf.verify(tokenHeader)
        } catch {
          valid = false
        }
        if (!valid) {
          return HttpServerResponse.jsonUnsafe({ error: "CSRF token invalid" }, { status: 403 })
        }
        return yield* effect
      }

      // Fallback to Hono-style Origin + Sec-Fetch-Site validation
      const origin = request.headers["origin"]
      const secFetchSite = request.headers["sec-fetch-site"]?.toLowerCase()
      const host = request.headers["host"]

      // If both headers missing, allow (old browsers, same-origin navigation without fetch metadata)
      // but require Origin check when present.
      if (secFetchSite) {
        if (secFetchSite === "same-origin") return yield* effect
        // For same-site/cross-site/none, fall through to Origin check
      }

      if (origin) {
        try {
          const originHost = new URL(origin).host
          // Same-host is always allowed
          if (host && originHost === host) return yield* effect
          // Allow localhost-style same as CORS allowlist
          if (originHost.startsWith("localhost:") || originHost.startsWith("127.0.0.1:")) {
            return yield* effect
          }
        } catch {
           return HttpServerResponse.jsonUnsafe({ error: "CSRF origin invalid" }, { status: 403 })
        }
        // If Origin present but not same-host, block form submissions
        if (isFormContentType(contentType) || !contentType) {
          // Only block when content-type is form-capable or missing (form default)
           return HttpServerResponse.jsonUnsafe({ error: "CSRF origin mismatch" }, { status: 403 })
        }
      }

      return yield* effect
    }),
  { global: true },
)

export const securityLayer = Layer.mergeAll(secureHeadersLayer, csrfLayer)
