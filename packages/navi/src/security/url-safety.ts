/**
 * URL Safety & SSRF Guard
 * Validates target URLs, prevents SSRF to internal loopbacks, cloud metadata (169.254.169.254),
 * link-local addresses, numeric-encoded IPs, and terminal control character injection.
 * Ported from Strix's url_safety.py & security guardrails.
 */

const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/

const PRIVATE_OR_LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "metadata.google.internal",
  "instance-data",
])

export function hasTerminalControl(s: string): boolean {
  return CONTROL_CHARS_REGEX.test(s)
}

export function isLooksNumericOrHex(label: string): boolean {
  const lowered = label.toLowerCase()
  if (lowered.startsWith("0x")) {
    return lowered.length > 2 && /^[0-9a-f]+$/.test(lowered.slice(2))
  }
  return /^\d+$/.test(lowered)
}

import { native } from "../memory/native"

export interface UrlSafetyResult {
  safe: boolean
  reason?: string
  parsedUrl?: URL
}

export function validateTargetUrl(rawUrl: string, options?: { allowLocalhost?: boolean }): UrlSafetyResult {
  if (native.isAvailable && native.validateUrl) {
    const res = native.validateUrl(rawUrl, options?.allowLocalhost)
    if (!res.safe) {
      return { safe: false, reason: res.reason }
    }
    try {
      return { safe: true, parsedUrl: new URL(rawUrl.trim()) }
    } catch {
      return { safe: false, reason: "Malformed URL syntax" }
    }
  }

  if (!rawUrl || typeof rawUrl !== "string") {
    return { safe: false, reason: "Empty or invalid URL input" }
  }

  const trimmed = rawUrl.trim()
  if (hasTerminalControl(trimmed)) {
    return { safe: false, reason: "Target URL contains illegal terminal control characters (CWE-117)" }
  }

  if (trimmed.includes("\\") || /\s/.test(trimmed)) {
    return { safe: false, reason: "URL contains backslashes or unencoded whitespace" }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { safe: false, reason: "Malformed URL syntax" }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `Unsupported protocol '${parsed.protocol}'. Only http: and https: are permitted.` }
  }

  if (parsed.username || parsed.password) {
    return { safe: false, reason: "URLs with embedded credentials in authority are disallowed" }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")

  if (!hostname) {
    return { safe: false, reason: "Missing hostname in target URL" }
  }

  if (options?.allowLocalhost) {
    return { safe: true, parsedUrl: parsed }
  }

  // Reject local hostnames
  if (
    PRIVATE_OR_LOCAL_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return { safe: false, reason: `Target points to local or private address: ${hostname}` }
  }

  // Cloud metadata endpoint protection (AWS, GCP, Azure, DigitalOcean 169.254.169.254)
  if (hostname === "169.254.169.254" || hostname.startsWith("169.254.")) {
    return { safe: false, reason: "Target points to cloud instance metadata service (SSRF protection)" }
  }

  // IPv6 handling. The URL parser keeps IPv6 hosts in brackets, e.g. "[::1]".
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const ipv6 = hostname.slice(1, -1)
    if (isBlockedIpv6(ipv6)) {
      return { safe: false, reason: "Target points to local or private address" }
    }
    return { safe: true, parsedUrl: parsed }
  }

  // Dotted-quad IPv4 literals: reject loopback, unspecified, link-local,
  // RFC1918 and CGNAT ranges. Public addresses such as 8.8.8.8 stay allowed.
  if (isIpv4Literal(hostname)) {
    if (isBlockedIpv4(hostname)) {
      return { safe: false, reason: "Target points to local or private address" }
    }
    return { safe: true, parsedUrl: parsed }
  }

  // Check numeric obfuscation (e.g. 0x7f000001, 2130706433).
  // A single all-numeric label is a packed IPv4 address in disguise.
  const labels = hostname.split(".")
  if (labels.length === 1 && isLooksNumericOrHex(hostname)) {
    return { safe: false, reason: "Hostname is represented as an obfuscated numeric/hex IP" }
  }
  if (labels.length > 1 && labels.every(isLooksNumericOrHex) && !isIpv4Literal(hostname)) {
    return { safe: false, reason: "Hostname is represented as an obfuscated numeric/hex IP" }
  }

  return { safe: true, parsedUrl: parsed }
}

/**
 * Returns true when the string is a well-formed dotted-quad IPv4 literal.
 */
function isIpv4Literal(host: string): boolean {
  const parts = host.split(".")
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/**
 * Expands an IPv6 literal into its 8 x 16-bit groups.
 * Handles "::" compression and a trailing embedded IPv4 form.
 * Returns null when the literal is malformed.
 */
function expandIpv6(literal: string): number[] | null {
  let text = literal.toLowerCase()

  // Fold a trailing dotted-quad into two hex groups: ::ffff:127.0.0.1 -> ::ffff:7f00:1
  const embedded = text.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (embedded) {
    const octets = embedded[1]!.split(".").map((o) => Number.parseInt(o, 10))
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null
    const high = ((octets[0]! << 8) | octets[1]!).toString(16)
    const low = ((octets[2]! << 8) | octets[3]!).toString(16)
    text = text.slice(0, embedded.index) + `${high}:${low}`
  }

  const [head, tail, ...rest] = text.split("::")
  if (rest.length > 0) return null

  const parseGroups = (part: string): number[] | null => {
    if (!part) return []
    const groups: number[] = []
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      groups.push(Number.parseInt(g, 16))
    }
    return groups
  }

  const headGroups = parseGroups(head ?? "")
  const tailGroups = tail === undefined ? [] : parseGroups(tail)
  if (!headGroups || !tailGroups) return null

  if (tail === undefined) {
    return headGroups.length === 8 ? headGroups : null
  }

  const fill = 8 - headGroups.length - tailGroups.length
  if (fill < 1) return null
  return [...headGroups, ...new Array<number>(fill).fill(0), ...tailGroups]
}

/**
 * Returns true when the IPv6 literal addresses a loopback, unspecified,
 * unique-local, link-local, or IPv4-mapped private address.
 */
function isBlockedIpv6(ipv6: string): boolean {
  const groups = expandIpv6(ipv6)
  if (!groups) return false

  const isZeroPrefix = groups.slice(0, 5).every((g) => g === 0)

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) forms
  if (isZeroPrefix && (groups[5] === 0xffff || groups[5] === 0)) {
    const mapped = [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join(".")
    return isBlockedIpv4(mapped)
  }

  const allZero = groups.every((g) => g === 0)
  if (allZero) return true

  // ::1 loopback
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true

  // fc00::/7 unique local
  if ((groups[0]! & 0xfe00) === 0xfc00) return true
  // fe80::/10 link local
  if ((groups[0]! & 0xffc0) === 0xfe80) return true

  return false
}

function isBlockedIpv4(ipv4: string): boolean {
  const octets = ipv4.split(".").map((o) => Number.parseInt(o, 10))
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false
  const [a, b] = octets as [number, number, number, number]
  if (a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && (b & 0xc0) === 64) return true
  return false
}
