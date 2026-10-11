import dns from "node:dns/promises"
import net from "node:net"

export class SSRFProtectionError extends Error {
  readonly _tag = "SSRF_VIOLATION"
  constructor(message: string, readonly url?: string) {
    super(`SSRF_VIOLATION: ${message}`)
    this.name = "SSRFProtectionError"
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true
  }
  const [a, b, c] = parts
  // 0.0.0.0/8
  if (a === 0) return true
  // 10.0.0.0/8
  if (a === 10) return true
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true
  // 169.254.0.0/16 (Link-local & AWS/GCP Metadata 169.254.169.254)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true
  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && b !== undefined && (b === 18 || b === 19)) return true
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true
  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (a !== undefined && a >= 224) return true

  return false
}

function isPrivateIPv6(ip: string): boolean {
  const norm = ip.toLowerCase()
  if (norm === "::" || norm === "::1" || norm === "0:0:0:0:0:0:0:0" || norm === "0:0:0:0:0:0:0:1") {
    return true
  }
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (norm.startsWith("::ffff:")) {
    const v4 = norm.replace(/^::ffff:/, "")
    if (net.isIPv4(v4)) {
      return isPrivateIPv4(v4)
    }
  }
  // Link-local (fe80::/10)
  if (norm.startsWith("fe80:") || norm.startsWith("fe8") || norm.startsWith("fe9") || norm.startsWith("fea") || norm.startsWith("feb")) {
    return true
  }
  // Unique local address (fc00::/7 -> fc00... or fd00...)
  if (norm.startsWith("fc") || norm.startsWith("fd")) {
    return true
  }
  return false
}

export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip)
  if (net.isIPv6(ip)) return isPrivateIPv6(ip)
  return true
}

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "169.254.169.254",
  "fd00:ec2::254",
])

export async function assertSafeExternalUrl(
  rawUrl: string,
  opts?: { allowLocalhost?: boolean },
): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (err) {
    throw new SSRFProtectionError(`Invalid or unparseable URL: ${rawUrl}`)
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== "http:" && protocol !== "https:") {
    throw new SSRFProtectionError(`Blocked protocol: ${protocol}. Only http: and https: are allowed.`, rawUrl)
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new SSRFProtectionError(`Access to cloud metadata or local internal host is blocked: ${hostname}`, rawUrl)
  }

  const isLoopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")

  if (isLoopback) {
    if (opts?.allowLocalhost) {
      return parsed
    }
    throw new SSRFProtectionError(`Access to loopback address (${hostname}) is blocked`, rawUrl)
  }

  // If hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new SSRFProtectionError(`Direct access to private/reserved IP address (${hostname}) is blocked`, rawUrl)
    }
    return parsed
  }

  // Resolve hostname via DNS to prevent DNS-rebinding attacks
  try {
    const records = await dns.lookup(hostname, { all: true })
    if (records.length === 0) {
      throw new SSRFProtectionError(`DNS resolution returned no records for host: ${hostname}`, rawUrl)
    }
    for (const record of records) {
      if (isPrivateIP(record.address)) {
        throw new SSRFProtectionError(
          `DNS rebinding blocked: Host "${hostname}" resolves to private/internal IP ${record.address}`,
          rawUrl,
        )
      }
    }
  } catch (err: any) {
    if (err instanceof SSRFProtectionError) throw err
    // If DNS fails to resolve, reject fail-closed
    throw new SSRFProtectionError(`DNS resolution failed for host "${hostname}": ${err?.message || String(err)}`, rawUrl)
  }

  return parsed
}
