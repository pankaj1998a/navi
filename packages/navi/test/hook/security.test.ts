import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as Hook from "../../src/hook/registry"
import { resolveHookTarget } from "../../src/hook/runner"

// Isolate the user-level config directory so a developer's global hooks.json
// does not leak into these tests.
const previousTestHome = process.env.NAVI_TEST_HOME
let home: string

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-home-"))
  process.env.NAVI_TEST_HOME = home
})

afterAll(async () => {
  if (previousTestHome === undefined) delete process.env.NAVI_TEST_HOME
  else process.env.NAVI_TEST_HOME = previousTestHome
  await fs.rm(home, { recursive: true, force: true })
})

afterEach(() => {
  delete process.env.NAVI_HOOKS_TRUSTED
  delete process.env.NAVI_HOOKS_ALLOW_PRIVATE
  delete process.env.NAVI_TEST_SECRET_TOKEN
})

async function project(hooks: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-project-"))
  await fs.mkdir(path.join(dir, ".navi"))
  await Bun.write(path.join(dir, ".navi", "hooks.json"), JSON.stringify(hooks))
  return dir
}

describe("hook trust model", () => {
  test("untrusted project hooks are skipped", async () => {
    const dir = await project({
      PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"should not run\"}'" }],
    })
    try {
      await Hook.loadHooks(dir)
      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(false)

      const result = await Hook.onPreToolUse("ses_test", dir, "bash", { command: "ls" })
      expect(result.shouldContinue).toBe(true)
      expect(result.blockReason).toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("trusted project hooks run", async () => {
    const dir = await project({
      PreToolUse: [{ type: "command", command: "echo '{\"continue\":false,\"blockReason\":\"trusted hook ran\"}'" }],
    })
    process.env.NAVI_HOOKS_TRUSTED = "1"
    try {
      await Hook.loadHooksOnce(dir)
      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(true)

      const result = await Hook.onPreToolUse("ses_test", dir, "bash", { command: "ls" })
      expect(result.shouldContinue).toBe(false)
      expect(result.blockReason).toBe("trusted hook ran")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("hooks are scoped per project directory", async () => {
    process.env.NAVI_HOOKS_TRUSTED = "1"
    const blocking = await project({
      PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"project A\"}'" }],
    })
    const clean = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-clean-"))
    try {
      await Hook.loadHooksOnce(blocking)
      await Hook.loadHooksOnce(clean)

      expect((await Hook.onPreToolUse("ses_test", blocking, "bash", {})).blockReason).toBe("project A")
      const other = await Hook.onPreToolUse("ses_test", clean, "bash", {})
      expect(other.shouldContinue).toBe(true)
      expect(await Hook.hasHooks("PreToolUse", clean)).toBe(false)
    } finally {
      await fs.rm(blocking, { recursive: true, force: true })
      await fs.rm(clean, { recursive: true, force: true })
    }
  })
})

describe("hook environment scrubbing", () => {
  test("command hooks get OS essentials but not secrets", async () => {
    process.env.NAVI_HOOKS_TRUSTED = "1"
    process.env.NAVI_TEST_SECRET_TOKEN = "leak-me"
    const dir = await project({
      PreToolUse: [
        {
          type: "command",
          command:
            "if [ -n \"$PATH\" ] && [ -z \"$NAVI_TEST_SECRET_TOKEN\" ]; then " +
            "echo '{\"blockReason\":\"scrubbed\"}'; " +
            "else echo '{\"blockReason\":\"leaked\"}'; fi",
        },
      ],
    })
    try {
      await Hook.loadHooksOnce(dir)
      const result = await Hook.onPreToolUse("ses_test", dir, "bash", {})
      expect(result.blockReason).toBe("scrubbed")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("hook HTTP SSRF protection", () => {
  test("private/loopback HTTP hook targets are blocked unless explicitly allowed", async () => {
    process.env.NAVI_HOOKS_TRUSTED = "1"
    let hits = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        hits += 1
        return Response.json({ systemMessage: "hook reached" })
      },
    })
    const dir = await project({
      PreToolUse: [{ type: "http", url: new URL("/hook", server.url).toString() }],
    })
    try {
      await Hook.loadHooksOnce(dir)
      const blocked = await Hook.onPreToolUse("ses_test", dir, "bash", {})
      expect(blocked.shouldContinue).toBe(true)
      expect(blocked.additionalContext).toBeUndefined()
      expect(hits).toBe(0)

      // Opt in explicitly, then reload so the state picks up the setting.
      process.env.NAVI_HOOKS_ALLOW_PRIVATE = "1"
      await Hook.loadHooks(dir)
      const allowed = await Hook.onPreToolUse("ses_test", dir, "bash", {})
      expect(allowed.shouldContinue).toBe(true)
      expect(hits).toBe(1)
    } finally {
      server.stop(true)
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("redirects are not followed into another host", async () => {
    process.env.NAVI_HOOKS_TRUSTED = "1"
    process.env.NAVI_HOOKS_ALLOW_PRIVATE = "1"
    let targetHits = 0
    const target = Bun.serve({
      port: 0,
      fetch() {
        targetHits += 1
        return Response.json({ systemMessage: "internal data" })
      },
    })
    const redirector = Bun.serve({
      port: 0,
      fetch() {
        return Response.redirect(target.url.toString(), 302)
      },
    })
    const dir = await project({
      PreToolUse: [{ type: "http", url: new URL("/hook", redirector.url).toString() }],
    })
    try {
      await Hook.loadHooks(dir)
      const result = await Hook.onPreToolUse("ses_test", dir, "bash", {})
      expect(result.shouldContinue).toBe(true)
      expect(result.additionalContext).toBeUndefined()
      expect(targetHits).toBe(0)
    } finally {
      redirector.stop(true)
      target.stop(true)
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("hook trust source isolation", () => {
  test("a project's own config cannot mark itself trusted", async () => {
    const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-home-repo-trust-"))
    const previous = process.env.NAVI_TEST_HOME
    process.env.NAVI_TEST_HOME = isolatedHome
    const dir = await project({ PreToolUse: [{ type: "command", command: "echo '{}'" }] })
    // Repo-controlled config claiming trust.
    await Bun.write(
      path.join(dir, "navi.json"),
      JSON.stringify({ hooks: { trusted: true, allow_private_network: true } }),
    )
    try {
      await Hook.loadHooks(dir)
      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(false)
    } finally {
      process.env.NAVI_TEST_HOME = previous
      await fs.rm(isolatedHome, { recursive: true, force: true })
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("user config hooks.trusted enables project hooks", async () => {
    const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-home-user-trust-"))
    const previous = process.env.NAVI_TEST_HOME
    process.env.NAVI_TEST_HOME = isolatedHome
    await fs.mkdir(path.join(isolatedHome, ".config", "Navi"), { recursive: true })
    await Bun.write(
      path.join(isolatedHome, ".config", "Navi", "config.json"),
      JSON.stringify({ hooks: { trusted: true } }),
    )
    const dir = await project({ PreToolUse: [{ type: "command", command: "echo '{}'" }] })
    try {
      await Hook.loadHooks(dir)
      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(true)
    } finally {
      process.env.NAVI_TEST_HOME = previous
      await fs.rm(isolatedHome, { recursive: true, force: true })
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("hook environment scrubbing (credential-shaped names)", () => {
  test("drops API keys, tokens, passwords and session material", async () => {
    process.env.NAVI_HOOKS_TRUSTED = "1"
    process.env.OPENAI_API_KEY = "sk-test"
    process.env.GITHUB_TOKEN = "ghp_test"
    process.env.DB_PASSWORD = "hunter2"
    process.env.AWS_SECRET_ACCESS_KEY = "aws-test"
    process.env.NAVI_SESSION_SECRET = "session-test"
    const out = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-env-"))
    const dump = path.join(out, "env.txt")
    const dir = await project({
      PreToolUse: [{ type: "command", command: `env > "${dump.replaceAll("\\", "/")}"` }],
    })
    try {
      await Hook.loadHooksOnce(dir)
      await Hook.onPreToolUse("ses_test", dir, "bash", {})
      const written = await fs.readFile(dump, "utf8")
      expect(written).not.toContain("sk-test")
      expect(written).not.toContain("ghp_test")
      expect(written).not.toContain("hunter2")
      expect(written).not.toContain("aws-test")
      expect(written).not.toContain("session-test")
      expect(written).toMatch(/^PATH=/m)
      expect(written).toMatch(/^HOME=/m)
    } finally {
      delete process.env.OPENAI_API_KEY
      delete process.env.GITHUB_TOKEN
      delete process.env.DB_PASSWORD
      delete process.env.AWS_SECRET_ACCESS_KEY
      delete process.env.NAVI_SESSION_SECRET
      await fs.rm(out, { recursive: true, force: true })
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("hook trust cannot be sourced from a project .env file", () => {
  test("NAVI_HOOKS_TRUSTED loaded from .env is ignored", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-dotenv-"))
    const previousCwd = process.cwd()
    const dir = await project({ PreToolUse: [{ type: "command", command: "echo '{}'" }] })
    process.env.NAVI_HOOKS_TRUSTED = "1"
    await Bun.write(path.join(cwd, ".env"), "NAVI_HOOKS_TRUSTED=1\n")
    try {
      process.chdir(cwd)
      await Hook.loadHooks(dir)
      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(false)
    } finally {
      process.chdir(previousCwd)
      await fs.rm(cwd, { recursive: true, force: true })
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("hook config reload", () => {
  test("a malformed hooks file is retried after it is fixed", async () => {
    process.env.NAVI_HOOKS_TRUSTED = "1"
    const dir = await project({})
    const file = path.join(dir, ".navi", "hooks.json")
    await Bun.write(file, "{ not json")
    try {
      await Hook.loadHooksOnce(dir)
      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(false)

      await Bun.write(
        file,
        JSON.stringify({
          PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"fixed\"}'" }],
        }),
      )
      // The failed load was not cached, so the next load retries the file.
      await Hook.loadHooksOnce(dir)
      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(true)
      const result = await Hook.onPreToolUse("ses_test", dir, "bash", {})
      expect(result.blockReason).toBe("fixed")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("hook state invalidation", () => {
  async function isolatedConfig(contents: unknown) {
    const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), "navi-hook-home-invalidate-"))
    const configDir = path.join(isolatedHome, ".config", "Navi")
    await fs.mkdir(configDir, { recursive: true })
    const configFile = path.join(configDir, "config.json")
    await Bun.write(configFile, JSON.stringify(contents))
    return { isolatedHome, configFile }
  }

  test("revoking hooks.trusted is picked up after the config mtime changes", async () => {
    const { isolatedHome, configFile } = await isolatedConfig({ hooks: { trusted: true } })
    const previous = process.env.NAVI_TEST_HOME
    process.env.NAVI_TEST_HOME = isolatedHome
    const dir = await project({
      PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"was trusted\"}'" }],
    })
    try {
      await Hook.loadHooks(dir)
      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(true)
      expect((await Hook.onPreToolUse("ses_test", dir, "bash", {})).blockReason).toBe("was trusted")

      // Revoke trust in the *user* config, then let the 1s stat throttle pass.
      await Bun.write(configFile, JSON.stringify({ hooks: { trusted: false } }))
      await Bun.sleep(1_100)

      expect(await Hook.hasHooks("PreToolUse", dir)).toBe(false)
      const after = await Hook.onPreToolUse("ses_test", dir, "bash", {})
      expect(after.shouldContinue).toBe(true)
      expect(after.blockReason).toBeUndefined()
    } finally {
      process.env.NAVI_TEST_HOME = previous
      await fs.rm(isolatedHome, { recursive: true, force: true })
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("editing .navi/hooks.json is picked up after the mtime changes", async () => {
    process.env.NAVI_HOOKS_TRUSTED = "1"
    const dir = await project({
      PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"v1\"}'" }],
    })
    try {
      await Hook.loadHooks(dir)
      expect((await Hook.onPreToolUse("ses_test", dir, "bash", {})).blockReason).toBe("v1")

      await Bun.write(
        path.join(dir, ".navi", "hooks.json"),
        JSON.stringify({ PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"version-two\"}'" }] }),
      )
      await Bun.sleep(1_100)

      expect((await Hook.onPreToolUse("ses_test", dir, "bash", {})).blockReason).toBe("version-two")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("a nested project with its own hooks file does not inherit ancestor hooks", async () => {
    process.env.NAVI_HOOKS_TRUSTED = "1"
    const parent = await project({
      PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"parent\"}'" }],
    })
    const child = path.join(parent, "packages", "child")
    await fs.mkdir(path.join(child, ".navi"), { recursive: true })
    await Bun.write(
      path.join(child, ".navi", "hooks.json"),
      JSON.stringify({ PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"child\"}'" }] }),
    )
    try {
      await Hook.loadHooksOnce(parent)
      expect((await Hook.onPreToolUse("ses_test", parent, "bash", {})).blockReason).toBe("parent")

      // The child declares its own hooks, so the ancestor state must not apply.
      expect((await Hook.onPreToolUse("ses_test", child, "bash", {})).blockReason).toBe("child")
      expect(await Hook.hasHooks("PreToolUse", child)).toBe(true)
    } finally {
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  test("a nested untrusted hooks file shadows a trusted ancestor", async () => {
    const dir = await project({ PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"ancestor\"}'" }] })
    const { isolatedHome } = await isolatedConfig({ hooks: { trusted: [dir] } })
    const previous = process.env.NAVI_TEST_HOME
    process.env.NAVI_TEST_HOME = isolatedHome
    const child = path.join(dir, "nested")
    await fs.mkdir(path.join(child, ".navi"), { recursive: true })
    await Bun.write(
      path.join(child, ".navi", "hooks.json"),
      JSON.stringify({ PreToolUse: [{ type: "command", command: "echo '{\"blockReason\":\"child\"}'" }] }),
    )
    try {
      await Hook.loadHooksOnce(dir)
      expect((await Hook.onPreToolUse("ses_test", dir, "bash", {})).blockReason).toBe("ancestor")

      // `dir` is trusted, `child` is not: the child's hooks are skipped and the
      // ancestor's hooks do not leak into it either.
      expect(await Hook.hasHooks("PreToolUse", child)).toBe(false)
      const result = await Hook.onPreToolUse("ses_test", child, "bash", {})
      expect(result.shouldContinue).toBe(true)
      expect(result.blockReason).toBeUndefined()
    } finally {
      process.env.NAVI_TEST_HOME = previous
      await fs.rm(isolatedHome, { recursive: true, force: true })
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe("hook DNS rebinding protection", () => {
  const publicAnswer = [{ address: "93.184.216.34", family: 4 }] as const

  test("a private address anywhere in the resolved set is rejected", async () => {
    const result = await resolveHookTarget("http://rebind.example.test/hook", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("169.254.169.254")
  })

  test("loopback and unique-local IPv6 answers are rejected", async () => {
    const loopback = await resolveHookTarget("https://hooks.example.test/hook", async () => [
      { address: "127.0.0.1", family: 4 },
    ])
    expect(loopback.ok).toBe(false)

    const uniqueLocal = await resolveHookTarget("https://hooks.example.test/hook", async () => [
      { address: "fd00::1", family: 6 },
    ])
    expect(uniqueLocal.ok).toBe(false)
  })

  test("unresolvable and empty answers fail closed", async () => {
    const failed = await resolveHookTarget("https://hooks.example.test/hook", async () => {
      throw new Error("ENOTFOUND")
    })
    expect(failed.ok).toBe(false)

    const empty = await resolveHookTarget("https://hooks.example.test/hook", async () => [])
    expect(empty.ok).toBe(false)
  })

  test("public-only resolution passes and http targets are pinned to the vetted IP", async () => {
    const result = await resolveHookTarget("http://hooks.example.test:8080/hook?x=1", async () => publicAnswer)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.target.addresses).toEqual(["93.184.216.34"])
      expect(result.target.fetchUrl).toBe("http://93.184.216.34:8080/hook?x=1")
      expect(result.target.hostHeader).toBe("hooks.example.test:8080")
    }
  })

  test("https targets keep the hostname (SNI cannot be pinned) but are still vetted", async () => {
    const result = await resolveHookTarget("https://hooks.example.test/hook", async () => publicAnswer)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.target.fetchUrl).toBe("https://hooks.example.test/hook")
      expect(result.target.hostHeader).toBeUndefined()
    }
  })
})
