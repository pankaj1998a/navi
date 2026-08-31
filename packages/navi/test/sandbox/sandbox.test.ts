import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import process from "node:process"
import {
  Sandbox,
  SandboxUnavailableError,
  MacSeatbeltBackend,
  LinuxBwrapBackend,
  WindowsAclBackend,
  type SandboxPolicy,
} from "@/sandbox"

describe("Sandbox", () => {
  const root = path.resolve("/test/workspace")

  describe("policy resolution and layers", () => {
    test("resolves default policy via Effect Service", async () => {
      const program = Effect.gen(function* () {
        const sandbox = yield* Sandbox.Service
        return yield* sandbox.resolvePolicy("workspace-write", root)
      })

      const policy = await Effect.runPromise(program.pipe(Effect.provide(Sandbox.defaultLayer)))
      expect(policy).toEqual({
        mode: "workspace-write",
        workspaceRoot: root,
      })
    })

    test("resolves read-only policy via Effect Service", async () => {
      const program = Effect.gen(function* () {
        const sandbox = yield* Sandbox.Service
        return yield* sandbox.resolvePolicy("read-only", root)
      })

      const policy = await Effect.runPromise(program.pipe(Effect.provide(Sandbox.defaultLayer)))
      expect(policy.mode).toBe("read-only")
    })
  })

  describe("danger-full-access mode", () => {
    test("runs completely unconfined without invoking platform sandboxes", () => {
      const policy: SandboxPolicy = {
        mode: "danger-full-access",
        workspaceRoot: root,
      }
      const confined = Sandbox.confineSync("echo", ["hello"], policy, { TEST_VAR: "1" })

      expect(confined.command).toBe("echo")
      expect(confined.args).toEqual(["hello"])
      expect(confined.mode).toBe("danger-full-access")
      expect(confined.enforcement).toBe("unconfined")
      expect(confined.backend).toBe("unconfined")
      expect(confined.env.TEST_VAR).toBe("1")
    })
  })

  describe("MacSeatbeltBackend", () => {
    test("generates read-only and workspace-write seatbelt profiles", () => {
      const roPolicy: SandboxPolicy = { mode: "read-only", workspaceRoot: "/Users/alice/repo" }
      const rwPolicy: SandboxPolicy = { mode: "workspace-write", workspaceRoot: "/Users/alice/repo" }

      const roConfined = MacSeatbeltBackend.confine("cat", ["file.txt"], roPolicy, {})
      expect(roConfined.command).toBe("/usr/bin/sandbox-exec")
      expect(roConfined.args[0]).toBe("-p")
      expect(roConfined.args[1]).toContain("(deny file-write*)")
      expect(roConfined.args[1]).not.toContain("/Users/alice/repo")
      expect(roConfined.args).toEqual(["-p", roConfined.args[1], "cat", "file.txt"])
      expect(roConfined.backend).toBe("seatbelt")
      expect(roConfined.enforcement).toBe("full")

      const rwConfined = MacSeatbeltBackend.confine("npm", ["test"], rwPolicy, {})
      expect(rwConfined.args[1]).toContain('(allow file-write* (subpath "/Users/alice/repo"))')
      expect(rwConfined.args[1]).toContain('(allow file-write* (subpath "/tmp"))')
    })
  })

  describe("LinuxBwrapBackend", () => {
    test("constructs proper bubblewrap ro-bind and write-bind flags", () => {
      const roPolicy: SandboxPolicy = { mode: "read-only", workspaceRoot: "/home/user/project" }
      const rwPolicy: SandboxPolicy = { mode: "workspace-write", workspaceRoot: "/home/user/project" }

      const roConfined = LinuxBwrapBackend.confine("ls", ["-la"], roPolicy, {})
      expect(roConfined.command).toBe("/usr/bin/bwrap")
      expect(roConfined.args).toContain("--ro-bind")
      expect(roConfined.args).toContain("--die-with-parent")
      expect(roConfined.args).not.toContain("--bind")
      expect(roConfined.backend).toBe("bwrap")
      expect(roConfined.enforcement).toBe("full")

      const rwConfined = LinuxBwrapBackend.confine("gcc", ["main.c"], rwPolicy, {})
      expect(rwConfined.args).toContain("--bind")
      expect(rwConfined.args).toContain("/home/user/project")
      expect(rwConfined.args).toContain("/tmp")
      expect(rwConfined.args.slice(-3)).toEqual(["--", "gcc", "main.c"])
    })
  })

  describe("WindowsAclBackend", () => {
    test("configures Windows restricted token and Job Object environment flags", () => {
      const rwPolicy: SandboxPolicy = { mode: "workspace-write", workspaceRoot: "C:\\projects\\app" }
      const roPolicy: SandboxPolicy = { mode: "read-only", workspaceRoot: "C:\\projects\\app" }

      const rwConfined = WindowsAclBackend.confine("node", ["index.js"], rwPolicy, { PATH: "C:\\node" })
      expect(rwConfined.command).toBe("node")
      expect(rwConfined.args).toEqual(["index.js"])
      expect(rwConfined.backend).toBe("windows-acl")
      expect(rwConfined.enforcement).toBe("full")
      expect(rwConfined.env.NAVI_SANDBOX_RESTRICTED_TOKEN).toBe("1")
      expect(rwConfined.env.NAVI_SANDBOX_JOB_OBJECT).toBe("1")
      expect(rwConfined.env.NAVI_SANDBOX_WRITE_RESTRICTED).toBe("1")
      expect(rwConfined.env.NAVI_SANDBOX_MODE).toBe("workspace-write")

      const roConfined = WindowsAclBackend.confine("node", ["index.js"], roPolicy, {})
      expect(roConfined.env.NAVI_SANDBOX_WRITE_RESTRICTED).toBe("0")
    })
  })

  describe("fail-closed rejection semantics", () => {
    test("throws typed SandboxUnavailableError when backend is unavailable", () => {
      const prev = process.env.NAVI_SANDBOX_DISABLE_WINDOWS
      try {
        process.env.NAVI_SANDBOX_DISABLE_WINDOWS = "true"
        if (process.platform === "win32") {
          expect(() =>
            Sandbox.confineSync("echo", ["hi"], { mode: "workspace-write", workspaceRoot: root }),
          ).toThrow(SandboxUnavailableError)
        }
      } finally {
        if (prev === undefined) delete process.env.NAVI_SANDBOX_DISABLE_WINDOWS
        else process.env.NAVI_SANDBOX_DISABLE_WINDOWS = prev
      }
    })

    test("Effect.confine propagates SandboxUnavailableError safely", async () => {
      const prev = process.env.NAVI_SANDBOX_DISABLE_WINDOWS
      try {
        process.env.NAVI_SANDBOX_DISABLE_WINDOWS = "true"
        if (process.platform === "win32") {
          const program = Effect.gen(function* () {
            const sandbox = yield* Sandbox.Service
            const policy: SandboxPolicy = { mode: "workspace-write", workspaceRoot: root }
            return yield* sandbox.confine("echo", ["hi"], policy)
          })

          const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(Sandbox.defaultLayer)))
          expect(exit._tag).toBe("Failure")
        }
      } finally {
        if (prev === undefined) delete process.env.NAVI_SANDBOX_DISABLE_WINDOWS
        else process.env.NAVI_SANDBOX_DISABLE_WINDOWS = prev
      }
    })
  })
})
