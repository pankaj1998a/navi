import { beforeEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigPermission } from "../../src/config/permission"
import { Permission } from "../../src/permission"
import {
  DEFAULT_PERMISSION_MODE,
  PermissionModeManager,
  resolvePermissionMode,
  setPermissionMode,
} from "../../src/permission/mode"
import * as NetworkPolicy from "../../src/permission/network"
import { Policy } from "../../src/permission/policy"

describe("permission mode", () => {
  beforeEach(() => {
    setPermissionMode("supervised")
  })

  test("defaults to supervised", () => {
    setPermissionMode(undefined)
    expect(DEFAULT_PERMISSION_MODE).toBe("supervised")
    expect(PermissionModeManager.getMode()).toBe("supervised")
  })

  test("config mode overrides the default", () => {
    const info = Schema.decodeUnknownSync(ConfigPermission.Info)({
      mode: "full_access",
      bash: "allow",
    })
    expect(info.mode).toBe("full_access")

    setPermissionMode(resolvePermissionMode(info))
    expect(PermissionModeManager.getMode()).toBe("full_access")
  })

  test("unknown config mode falls back to supervised", () => {
    expect(resolvePermissionMode({ mode: "yolo" })).toBe("supervised")
    expect(resolvePermissionMode(undefined)).toBe("supervised")
  })

  test("setMode is safe against invalid runtime values", () => {
    setPermissionMode("full_access")
    PermissionModeManager.setMode("bogus" as never)
    expect(PermissionModeManager.getMode()).toBe("full_access")
  })

  test("supervised gates shell but not read tools", () => {
    expect(PermissionModeManager.requiresApproval("bash")).toBe(true)
    expect(PermissionModeManager.requiresApproval("shell")).toBe(true)
    expect(PermissionModeManager.requiresApproval("read")).toBe(false)
    expect(PermissionModeManager.requiresApproval("grep")).toBe(false)
  })

  test("full_access auto-approves but explicit rules still apply", () => {
    setPermissionMode("full_access")
    expect(PermissionModeManager.requiresApproval("bash")).toBe(false)
    expect(PermissionModeManager.requiresApproval("edit")).toBe(false)
  })

  test("mode is not emitted as a permission rule", () => {
    const info = Schema.decodeUnknownSync(ConfigPermission.Info)({
      mode: "auto_accept_edits",
      bash: "allow",
      edit: "deny",
    })
    expect(
      Permission.fromConfig(info).sort((a, b) => a.permission.localeCompare(b.permission)),
    ).toEqual([
      { permission: "bash", pattern: "*", action: "allow" },
      { permission: "edit", pattern: "*", action: "deny" },
    ])
  })

  test("modes are scoped per instance directory", () => {
    setPermissionMode("supervised")
    setPermissionMode("full_access", "/repo-a")
    expect(PermissionModeManager.getMode("/repo-a")).toBe("full_access")
    // A second open project must not inherit full_access from the first.
    expect(PermissionModeManager.getMode("/repo-b")).toBe("supervised")
    expect(PermissionModeManager.getMode()).toBe("supervised")
    PermissionModeManager.clearScope("/repo-a")
    expect(PermissionModeManager.getMode("/repo-a")).toBe("supervised")
  })
})

describe("policy precedence", () => {
  test("deny wins over ask and allow regardless of mode", () => {
    expect(Policy.resolveAskOutcome({ matches: ["deny"], modeRequiresApproval: false })).toBe("deny")
    expect(Policy.resolveAskOutcome({ matches: ["allow", "deny", "ask"], modeRequiresApproval: false })).toBe("deny")
    expect(Policy.decide(["allow", "ask", "deny"])).toBe("deny")
  })

  test("explicit ask prompts even when the mode would allow", () => {
    expect(Policy.resolveAskOutcome({ matches: ["ask"], modeRequiresApproval: false })).toBe("ask")
    expect(Policy.resolveAskOutcome({ matches: ["allow", "ask"], modeRequiresApproval: false })).toBe("ask")
  })

  test("all explicit allows skip the prompt", () => {
    expect(Policy.resolveAskOutcome({ matches: ["allow", "allow"], modeRequiresApproval: true })).toBe("allow")
  })

  test("unmatched rules fall back to the mode default", () => {
    expect(Policy.resolveAskOutcome({ matches: [undefined], modeRequiresApproval: true })).toBe("ask")
    expect(Policy.resolveAskOutcome({ matches: [undefined], modeRequiresApproval: false })).toBe("allow")
    expect(Policy.decide([], "allow")).toBe("allow")
    expect(Policy.decide([], "ask")).toBe("ask")
  })

  test("policy evaluate applies deny over a later wildcard allow", () => {
    const decision = Policy.evaluate("bash", "rm -rf /", [
      [
        { permission: "bash", pattern: "rm *", action: "deny" },
        { permission: "bash", pattern: "*", action: "allow" },
      ],
    ])
    expect(decision.action).toBe("deny")
  })

  test("policy evaluate uses prefix matching for shell rules", () => {
    const decision = Policy.evaluate("bash", "git push origin main", [
      [{ permission: "bash", pattern: "git push", action: "ask" }],
    ])
    expect(decision.action).toBe("ask")
    expect(decision.rule?.pattern).toBe("git push")
  })
})

describe("prefix and arity matching", () => {
  test("non-glob shell rules match by token prefix", () => {
    expect(Policy.matchesCommand("git checkout main", "git checkout")).toBe(true)
    expect(Policy.matchesCommand("git commit -m x", "git checkout")).toBe(false)
    expect(Policy.matchesCommand("rm -rf /", "rm")).toBe(true)
    expect(Policy.matchesCommand("npm run dev", "npm run dev")).toBe(true)
    expect(Policy.matchesCommand("npm run dev", "npm install")).toBe(false)
  })

  test("glob rules keep whole-command semantics", () => {
    expect(Policy.matchesCommand("npm run dev", "npm *")).toBe(true)
    expect(Policy.matchesCommand("npm run dev", "* run *")).toBe(true)
  })

  test("non-shell permissions use glob matching", () => {
    expect(Policy.matchesPattern("edit", "src/foo.ts", "src/*")).toBe(true)
    expect(Policy.matchesPattern("edit", "src/foo.ts", "src")).toBe(false)
  })
})

describe("network policy", () => {
  test("exact host matching", () => {
    expect(NetworkPolicy.matchHost("api.example.com", "api.example.com")).toBe(true)
    expect(NetworkPolicy.matchHost("API.Example.com", "api.example.com")).toBe(true)
    expect(NetworkPolicy.matchHost("evil.example.com", "api.example.com")).toBe(false)
  })

  test("wildcard subdomains match descendants but not the apex", () => {
    expect(NetworkPolicy.matchHost("api.example.com", "*.example.com")).toBe(true)
    expect(NetworkPolicy.matchHost("a.b.example.com", "*.example.com")).toBe(true)
    expect(NetworkPolicy.matchHost("example.com", "*.example.com")).toBe(false)
    expect(NetworkPolicy.matchHost("notexample.com", "*.example.com")).toBe(false)
  })

  test("deny wins over allow", () => {
    const policy = { allow: ["*.example.com"], deny: ["secret.example.com"] }
    expect(NetworkPolicy.hostAllowed("api.example.com", policy)).toBe(true)
    expect(NetworkPolicy.hostAllowed("secret.example.com", policy)).toBe(false)
  })

  test("empty allowlist permits everything not denied", () => {
    expect(NetworkPolicy.hostAllowed("anything.test", {})).toBe(true)
    expect(NetworkPolicy.hostAllowed("anything.test", { allow: [] })).toBe(true)
    expect(NetworkPolicy.hostAllowed("anything.test", { deny: ["*.test"] })).toBe(false)
  })

  test("non-empty allowlist restricts hosts", () => {
    const policy = { allow: ["api.example.com"] }
    expect(NetworkPolicy.hostAllowed("api.example.com", policy)).toBe(true)
    expect(NetworkPolicy.hostAllowed("other.example.com", policy)).toBe(false)
  })

  test("url checks fail closed", () => {
    expect(NetworkPolicy.urlAllowed("https://api.example.com/v1", { allow: ["api.example.com"] })).toBe(true)
    expect(NetworkPolicy.urlAllowed("ftp://api.example.com/v1", { allow: ["api.example.com"] })).toBe(false)
    expect(NetworkPolicy.urlAllowed("not a url", {})).toBe(false)
  })

  test("normalizeHost handles URLs, ports, and IPv6", () => {
    expect(NetworkPolicy.normalizeHost("https://API.example.com:8443/path")).toBe("api.example.com")
    expect(NetworkPolicy.normalizeHost("example.com:443")).toBe("example.com")
    expect(NetworkPolicy.normalizeHost("[::1]:8080")).toBe("::1")
  })
})
