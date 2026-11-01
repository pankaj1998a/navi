import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as NetworkPolicy from "../../src/permission/network"

describe("network policy resolution", () => {
  test("no policy configured allows every host", () => {
    expect(NetworkPolicy.resolve(undefined, {})).toBeUndefined()
    expect(NetworkPolicy.resolve({}, {})).toBeUndefined()
    expect(NetworkPolicy.resolve({ network: {} }, {})).toBeUndefined()
  })

  test("config allowlist denies hosts that are not listed", () => {
    const policy = NetworkPolicy.resolve({ network: { "api.example.com": "allow", "*.corp.test": "deny" } }, {})
    expect(policy).toBeDefined()
    expect(NetworkPolicy.urlAllowed("https://api.example.com/v1", policy!)).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://other.example.com/v1", policy!)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://api.corp.test/v1", policy!)).toBe(false)
  })

  test("a deny-only policy still fails closed for unlisted hosts", () => {
    const policy = NetworkPolicy.resolve({ network: { "*.tracker.test": "deny" } }, {})
    expect(NetworkPolicy.urlAllowed("https://cdn.example.com/x", policy!)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://cdn.tracker.test/x", policy!)).toBe(false)
  })

  test("environment allow/deny lists extend the config policy", () => {
    const policy = NetworkPolicy.resolve(
      { network: { "api.example.com": "allow" } },
      {
        NAVI_NETWORK_ALLOW: "docs.example.com, *.search.test",
        NAVI_NETWORK_DENY: "evil.search.test",
      },
    )
    expect(NetworkPolicy.urlAllowed("https://api.example.com", policy!)).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://docs.example.com", policy!)).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://results.search.test", policy!)).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://evil.search.test", policy!)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://unlisted.test", policy!)).toBe(false)
  })

  test("legacy policies keep allow-all-except-denied semantics", () => {
    expect(NetworkPolicy.hostAllowed("anything.test", {})).toBe(true)
    expect(NetworkPolicy.hostAllowed("anything.test", { default: "deny" })).toBe(false)
    expect(NetworkPolicy.hostAllowed("ok.test", { allow: ["ok.test"], default: "deny" })).toBe(true)
  })

  test("enforcement throws for blocked hosts and bad protocols", () => {
    const policy = NetworkPolicy.resolve({ network: { "api.example.com": "allow" } }, {})
    expect(() => NetworkPolicy.assertUrlAllowed("https://api.example.com/x", policy)).not.toThrow()
    expect(() => NetworkPolicy.assertUrlAllowed("https://other.example.com/x", policy)).toThrow(
      NetworkPolicy.NetworkBlockedError,
    )
    expect(() => NetworkPolicy.assertUrlAllowed("ftp://api.example.com/x", policy)).toThrow(
      NetworkPolicy.NetworkBlockedError,
    )
    expect(() => NetworkPolicy.assertUrlAllowed("file:///etc/passwd", policy)).toThrow(
      NetworkPolicy.NetworkBlockedError,
    )
    // No policy: enforcement is a no-op.
    expect(() => NetworkPolicy.assertUrlAllowed("https://anything.test", undefined)).not.toThrow()
  })

  test("trailing-dot, uppercase and IDN hosts cannot bypass a deny rule", () => {
    const deny = { deny: ["evil.com", "пример.рф"], default: "allow" as const }
    expect(NetworkPolicy.urlAllowed("https://evil.com/x", deny)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://evil.com./x", deny)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://EVIL.com./x", deny)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://xn--e1afmkfd.xn--p1ai/x", deny)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://xn--e1afmkfd.xn--p1ai./x", deny)).toBe(false)
  })

  test("trailing-dot hosts still match an allowlist entry", () => {
    const allow = { allow: ["api.example.com", "пример.рф"], default: "deny" as const }
    expect(NetworkPolicy.urlAllowed("https://api.example.com./x", allow)).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://xn--e1afmkfd.xn--p1ai/x", allow)).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://xn--e1afmkfd.xn--p1ai./x", allow)).toBe(true)
    expect(
      NetworkPolicy.hostAllowed("a.xn--e1afmkfd.xn--p1ai", { allow: ["*.пример.рф"], default: "deny" }),
    ).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://other.example.com./x", allow)).toBe(false)
  })

  test("IPv6 literal hosts and wildcard apex semantics", () => {
    const policy = { allow: ["[::1]", "*.example.com"], default: "deny" as const }
    expect(NetworkPolicy.urlAllowed("http://[::1]:8080/x", policy)).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://example.com/x", policy)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://a.b.example.com/x", policy)).toBe(true)
    expect(NetworkPolicy.urlAllowed("https://notexample.com/x", policy)).toBe(false)
  })

  test("deny wins even when the host also matches an env allow entry", () => {
    const policy = NetworkPolicy.resolve(
      { network: { "api.example.com": "allow" } },
      { NAVI_NETWORK_ALLOW: "api.example.com", NAVI_NETWORK_DENY: "api.example.com" },
    )
    expect(NetworkPolicy.urlAllowed("https://api.example.com/x", policy!)).toBe(false)
    expect(NetworkPolicy.urlAllowed("https://api.example.com./x", policy!)).toBe(false)
  })

  test("env overrides supplied by a project .env file are ignored", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "navi-net-env-"))
    fs.writeFileSync(path.join(dir, ".env"), "NAVI_NETWORK_ALLOW=*\n")
    const previousCwd = process.cwd()
    const previousAllow = process.env.NAVI_NETWORK_ALLOW
    try {
      process.chdir(dir)
      process.env.NAVI_NETWORK_ALLOW = "*"
      expect(NetworkPolicy.environmentFileKeys(dir).has("NAVI_NETWORK_ALLOW")).toBe(true)
      // Tainted value is dropped: no policy remains, so hosts stay allowed but
      // no user policy was widened by repo content.
      expect(NetworkPolicy.resolve(undefined, process.env)).toBeUndefined()
    } finally {
      process.chdir(previousCwd)
      if (previousAllow === undefined) delete process.env.NAVI_NETWORK_ALLOW
      else process.env.NAVI_NETWORK_ALLOW = previousAllow
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("example env files are not treated as auto-loaded trust sources", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "navi-net-example-"))
    fs.writeFileSync(path.join(dir, ".env.example"), "NAVI_NETWORK_ALLOW=*\n")
    try {
      expect(NetworkPolicy.environmentFileKeys(dir).has("NAVI_NETWORK_ALLOW")).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
