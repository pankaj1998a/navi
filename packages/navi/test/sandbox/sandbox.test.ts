import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import process from "node:process"
import {
  Sandbox,
  SandboxPathGuard,
  SandboxUnavailableError,
  MacSeatbeltBackend,
  LinuxBwrapBackend,
  WindowsAclBackend,
  assertCommandContained,
  assertCwdContained,
  isPathContained,
  type SandboxMode,
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
      expect(roConfined.args).toEqual(["-p", roConfined.args[1] ?? "", "cat", "file.txt"])
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
    test("reports partial tool-layer enforcement without claiming OS isolation", () => {
      const rwPolicy: SandboxPolicy = { mode: "workspace-write", workspaceRoot: "C:\\projects\\app" }
      const roPolicy: SandboxPolicy = { mode: "read-only", workspaceRoot: "C:\\projects\\app" }

      const rwConfined = WindowsAclBackend.confine("node", ["index.js"], rwPolicy, { PATH: "C:\\node" })
      expect(rwConfined.command).toBe("node")
      expect(rwConfined.args).toEqual(["index.js"])
      expect(rwConfined.backend).toBe("windows-acl")
      expect(rwConfined.enforcement).toBe("partial")
      expect(rwConfined.env.NAVI_SANDBOX_ENFORCEMENT).toBe("partial")
      expect(rwConfined.env.NAVI_SANDBOX_WRITE_RESTRICTED).toBe("1")
      expect(rwConfined.env.NAVI_SANDBOX_MODE).toBe("workspace-write")
      // No native DACL, restricted token, or Job Object helper is applied on
      // Windows, so no marker may claim one exists.
      expect(rwConfined.env.NAVI_SANDBOX_RESTRICTED_TOKEN).toBeUndefined()
      expect(rwConfined.env.NAVI_SANDBOX_JOB_OBJECT).toBeUndefined()

      const roConfined = WindowsAclBackend.confine("node", ["index.js"], roPolicy, {})
      expect(roConfined.enforcement).toBe("partial")
      // Writes are denied in both partial modes; read-only additionally relies
      // on the tool-layer guards to refuse every write command.
      expect(roConfined.env.NAVI_SANDBOX_WRITE_RESTRICTED).toBe("1")
    })
  })

  describe("fail-closed rejection semantics", () => {
    test("SandboxPathGuard denies writes to VCS internals and env secrets", () => {
      const policy: SandboxPolicy = { mode: "workspace-write", workspaceRoot: root }
      expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, ".git", "config"), policy, true)).toThrow(
        /SANDBOX_VIOLATION/,
      )
      expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, ".env"), policy, true)).toThrow(
        /SANDBOX_VIOLATION/,
      )
      // Reads stay allowed; only direct writes are fenced.
      expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, ".git", "config"), policy, false)).not.toThrow()
    })

    test("SandboxPathGuard denies writes outside the workspace root", () => {
      const policy: SandboxPolicy = { mode: "workspace-write", workspaceRoot: root }
      expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, "..", "outside.txt"), policy, true)).toThrow(
        /SANDBOX_VIOLATION/,
      )
      expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, "notes.txt"), policy, true)).not.toThrow()
    })

    test("throws typed SandboxUnavailableError when backend is unavailable", () => {
      const prev = process.env.NAVI_SANDBOX_DISABLE_WINDOWS
      try {
        process.env.NAVI_SANDBOX_DISABLE_WINDOWS = "true"
        if (process.platform === "win32") {
          expect(() => Sandbox.confineSync("echo", ["hi"], { mode: "workspace-write", workspaceRoot: root })).toThrow(
            SandboxUnavailableError,
          )
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

describe("Sandbox tool-layer containment", () => {
  // `C:\Work\Repo` does not exist, which is the interesting case: the guard
  // must decide containment from the normalized spelling alone.
  const repo = path.resolve(process.platform === "win32" ? "C:\\Work\\Repo" : "/work/repo")
  const outside = path.resolve(repo, "..", "Other")
  const sandboxPolicy = (mode: SandboxMode): SandboxPolicy => ({ mode, workspaceRoot: repo })

  test("accepts spelled variants of in-workspace targets", () => {
    const variants = [repo, repo.replaceAll("\\", "/"), repo.toLowerCase()]
    for (const variant of variants) {
      expect(isPathContained(repo, path.join(variant, "src", "index.ts"))).toBe(true)
      expect(() => assertCwdContained(path.join(variant, "src"), sandboxPolicy("workspace-write"))).not.toThrow()
    }
    expect(isPathContained(repo, path.join(outside, "x"))).toBe(false)
    expect(() => assertCwdContained(outside, sandboxPolicy("workspace-write"))).toThrow(/SANDBOX_VIOLATION/)
  })

  test("rejects redirects, cd chains, nested shells and Set-Content outside", () => {
    const rw = sandboxPolicy("workspace-write")
    expect(() => assertCommandContained(`echo pwn > ${path.join(outside, "x")}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`cd ${outside} && rm secret.txt`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`bash -c 'touch ${path.join(outside, "x")}'`, rw)).toThrow(/escapes/)
    expect(() =>
      assertCommandContained(`powershell -Command "Set-Content ${path.join(outside, "x")} hi"`, rw, {
        shell: "powershell",
      }),
    ).toThrow(/escapes/)
    expect(() => assertCommandContained("echo ok > inside.txt", rw)).not.toThrow()
  })

  test("read-only rejects every write form", () => {
    const ro = sandboxPolicy("read-only")
    expect(() => assertCommandContained("rm notes.txt", ro)).toThrow(/read-only/)
    expect(() => assertCommandContained("echo pwn > notes.txt", ro)).toThrow(/read-only/)
    expect(() => assertCommandContained("Set-Content notes.txt hi", ro, { shell: "powershell" })).toThrow(/read-only/)
    expect(() => SandboxPathGuard.assertPathAllowed(path.join(repo, "notes.txt"), ro, true)).toThrow(/read-only/)
    expect(() => assertCommandContained("ls -la", ro)).not.toThrow()
  })

  test("checks the base name of a path-qualified command", () => {
    const rw = sandboxPolicy("workspace-write")
    const ro = sandboxPolicy("read-only")
    const target = path.join(outside, "x")
    expect(() => assertCommandContained(`/bin/rm -rf ${target}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`/usr/bin/sed -i s/a/b/ ${target}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`/usr/bin/sudo touch ${target}`, rw)).toThrow(/Privilege escalation/)
    expect(() => assertCommandContained("/bin/rm notes.txt", ro)).toThrow(/read-only/)
    expect(() => assertCommandContained("/usr/bin/truncate -s 0 notes.txt", ro)).toThrow(/read-only/)
  })

  test("checks option-style and newly tabled write targets", () => {
    const rw = sandboxPolicy("workspace-write")
    const ro = sandboxPolicy("read-only")
    const target = path.join(outside, "x")
    for (const command of [
      `ln -s x ${target}`,
      `truncate -s 0 ${target}`,
      `sort -o ${target} a`,
      `install a ${target}`,
      `wget -P ${outside} http://example.com`,
    ])
      expect(() => assertCommandContained(command, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`"x" | Tee-Object -FilePath ${target}`, rw, { shell: "powershell" })).toThrow(
      /escapes/,
    )
    expect(() => assertCommandContained(`gci | Export-Csv ${target}`, rw, { shell: "powershell" })).toThrow(/escapes/)
    expect(() => assertCommandContained(`ln -s a b`, ro)).toThrow(/read-only/)
    expect(() => assertCommandContained(`"x" | Tee-Object -FilePath b`, ro, { shell: "powershell" })).toThrow(
      /read-only/,
    )
    // A content writer's value may legitimately be an absolute path.
    expect(() =>
      assertCommandContained(`Set-Item Env:PATH C:\\Windows\\System32`, rw, { shell: "powershell" }),
    ).not.toThrow()
  })

  test("models cmd.exe write commands and nested shells", () => {
    const rw = sandboxPolicy("workspace-write")
    const ro = sandboxPolicy("read-only")
    const target = path.join(outside, "x")
    expect(() => assertCommandContained(`del ${target}`, rw, { shell: "cmd" })).toThrow(/escapes/)
    expect(() => assertCommandContained(`@del ${target}`, rw, { shell: "cmd" })).toThrow(/escapes/)
    expect(() => assertCommandContained(`copy a ${target}`, rw, { shell: "cmd" })).toThrow(/escapes/)
    expect(() => assertCommandContained(`runas /user:Admin cmd`, rw, { shell: "cmd" })).toThrow(/Privilege escalation/)
    expect(() => assertCommandContained(`cmd /c "del ${target}"`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`echo hi && cmd /c "del ${target}"`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`echo hi && pwsh -Command "Set-Content ${target} hi"`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained("del notes.txt", ro, { shell: "cmd" })).toThrow(/read-only/)
    // Reads and inside-workspace writes stay allowed.
    expect(() => assertCommandContained(`type ${target}`, rw, { shell: "cmd" })).not.toThrow()
    expect(() => assertCommandContained(`copy a ${path.join(repo, "b")}`, rw, { shell: "cmd" })).not.toThrow()
  })
})
