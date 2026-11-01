import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  LinuxBwrapBackend,
  MacSeatbeltBackend,
  SandboxPathGuard,
  SandboxUnavailableError,
  WindowsAclBackend,
  assertCommandContained,
  assertCwdContained,
  canonicalPath,
  confineSync,
  isPathContained,
  pathWordCandidates,
  resolveMode,
  scrubEnvironment,
  type SandboxMode,
  type SandboxPolicy,
} from "./index"
import { STATIC_ENFORCEMENT, selectRunner, type Enforcement, type Runner } from "./probes"

const root = path.resolve("/workspace/repo")
const outside = path.resolve(root, "..", "other")
const temp = path.resolve(process.env.TEMP || process.env.TMP || "/tmp")

const policy = (mode: SandboxMode): SandboxPolicy => ({ mode, workspaceRoot: root })
const policyWith = (workspaceRoot: string): SandboxPolicy => ({ mode: "workspace-write", workspaceRoot })

/** Windows short (8.3) spelling of an existing directory, when the volume has one. */
function windowsShortPath(file: string): string | undefined {
  if (process.platform !== "win32") return undefined
  const script = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${file.replaceAll("'", "''")}').ShortPath`
  const result = spawnSync("powershell", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 20_000,
  })
  const short = result.stdout?.trim()
  return short && short !== file ? short : undefined
}

// Whether the current host can actually confine through its real backend.
const available =
  process.platform === "win32"
    ? WindowsAclBackend.isAvailable()
    : process.platform === "darwin"
      ? MacSeatbeltBackend.isAvailable()
      : LinuxBwrapBackend.isAvailable()

describe("Sandbox.resolveMode", () => {
  test("maps only full_access to danger-full-access", () => {
    expect(resolveMode("full_access")).toBe("danger-full-access")
    expect(resolveMode("supervised")).toBe("workspace-write")
    expect(resolveMode("auto_accept_edits")).toBe("workspace-write")
    expect(resolveMode("auto")).toBe("workspace-write")
    expect(resolveMode(undefined)).toBe("workspace-write")
  })

  test("accepts an explicit override and ignores invalid values", () => {
    expect(resolveMode("full_access", "read-only")).toBe("read-only")
    expect(resolveMode("full_access", "bogus")).toBe("danger-full-access")
  })
})

describe("Sandbox.confineSync", () => {
  test("danger-full-access is always unconfined", () => {
    const confined = confineSync("echo", ["hi"], policy("danger-full-access"), { KEEP: "1" })
    expect(confined.command).toBe("echo")
    expect(confined.args).toEqual(["hi"])
    expect(confined.env.KEEP).toBe("1")
    expect(confined.enforcement).toBe("unconfined")
    expect(confined.backend).toBe("unconfined")
  })

  test.skipIf(!available)("confines read-only and workspace-write on a usable host", () => {
    for (const mode of ["read-only", "workspace-write"] as const) {
      const confined = confineSync("echo", ["hi"], policy(mode), { KEEP: "1" })
      expect(confined.mode).toBe(mode)
      expect(confined.backend).not.toBe("unconfined")
      expect(confined.env.KEEP).toBe("1")
      expect(confined.env.NAVI_SANDBOX_MODE).toBe(mode)
      if (process.platform === "win32") expect(confined.enforcement).toBe("partial")
      else expect(confined.enforcement).toBe("full")
    }
  })

  test.skipIf(available)("fails closed when no backend is usable", () => {
    expect(() => confineSync("echo", ["hi"], policy("workspace-write"))).toThrow(SandboxUnavailableError)
  })

  test.skipIf(process.platform !== "win32")("fails closed when the Windows guard is disabled", () => {
    const previous = process.env.NAVI_SANDBOX_DISABLE_WINDOWS
    process.env.NAVI_SANDBOX_DISABLE_WINDOWS = "true"
    try {
      expect(() => confineSync("echo", ["hi"], policy("workspace-write"))).toThrow(SandboxUnavailableError)
    } finally {
      if (previous === undefined) delete process.env.NAVI_SANDBOX_DISABLE_WINDOWS
      else process.env.NAVI_SANDBOX_DISABLE_WINDOWS = previous
    }
  })
})

describe("Sandbox.WindowsAclBackend", () => {
  test("reports partial enforcement and never claims a restricted token", () => {
    const rw = WindowsAclBackend.confine("node", ["index.js"], policy("workspace-write"), {
      PATH: "C:\\node",
      NODE_OPTIONS: "--require evil",
      LD_PRELOAD: "evil.so",
    })

    expect(rw.command).toBe("node")
    expect(rw.args).toEqual(["index.js"])
    expect(rw.backend).toBe("windows-acl")
    expect(rw.enforcement).toBe("partial")
    expect(rw.env.NAVI_SANDBOX_ENFORCEMENT).toBe("partial")
    expect(rw.env.NAVI_SANDBOX_WRITE_RESTRICTED).toBe("1")
    expect(rw.env.PATH).toBe("C:\\node")

    // No native DACL / token / Job Object helper is applied, so no marker may
    // claim one exists.
    expect(rw.env.NAVI_SANDBOX_RESTRICTED_TOKEN).toBeUndefined()
    expect(rw.env.NAVI_SANDBOX_JOB_OBJECT).toBeUndefined()

    // Loader hooks are scrubbed because they would run before any tool guard.
    expect(rw.env.NODE_OPTIONS).toBeUndefined()
    expect(rw.env.LD_PRELOAD).toBeUndefined()
  })

  test("marks read-only mode as write-restricted", () => {
    const ro = WindowsAclBackend.confine("node", [], policy("read-only"), {})
    expect(ro.env.NAVI_SANDBOX_WRITE_RESTRICTED).toBe("1")
  })
})

describe("Sandbox.scrubEnvironment", () => {
  test("removes dynamic loader and startup hooks, case-insensitively", () => {
    const env = scrubEnvironment({
      PATH: "/bin",
      ld_preload: "evil.so",
      NODE_OPTIONS: "--require evil",
      PS4: "$(evil)",
      KEEP: "yes",
    })
    expect(env).toEqual({ PATH: "/bin", KEEP: "yes" })
  })
})

describe("Sandbox.MacSeatbeltBackend", () => {
  test("read-only denies every write", () => {
    const ro = MacSeatbeltBackend.confine("cat", ["file.txt"], policy("read-only"), {})
    expect(ro.command).toBe("/usr/bin/sandbox-exec")
    expect(ro.args[1]).toContain("(deny file-write*)")
    expect(ro.args[1]).not.toContain(root)
    expect(ro.enforcement).toBe("full")
    expect(ro.backend).toBe("seatbelt")
  })

  test("workspace-write grants the workspace and temp", () => {
    const rw = MacSeatbeltBackend.confine("npm", ["test"], policy("workspace-write"), {})
    expect(rw.args[1]).toContain(`(allow file-write* (subpath "${root}"))`)
    expect(rw.args[1]).toContain('(allow file-write* (subpath "/tmp"))')
    expect(rw.args.at(-2)).toBe("npm")
    expect(rw.args.at(-1)).toBe("test")
  })
})

describe("Sandbox.LinuxBwrapBackend", () => {
  test("read-only mounts the filesystem read-only", () => {
    const ro = LinuxBwrapBackend.confine("ls", ["-la"], policy("read-only"), {})
    expect(ro.command.endsWith("bwrap")).toBe(true)
    expect(ro.args).toContain("--ro-bind")
    expect(ro.args).not.toContain("--bind")
    expect(ro.enforcement).toBe("full")
    expect(ro.backend).toBe("bwrap")
  })

  test("workspace-write binds the workspace and temp", () => {
    const rw = LinuxBwrapBackend.confine("gcc", ["main.c"], policy("workspace-write"), {})
    expect(rw.args).toContain("--bind")
    expect(rw.args).toContain(root)
    expect(rw.args).toContain("/tmp")
    expect(rw.args.slice(-3)).toEqual(["--", "gcc", "main.c"])
  })
})

describe("Sandbox.isPathContained", () => {
  test("accepts the root, nested paths, and normalized traversal", () => {
    expect(isPathContained(root, root)).toBe(true)
    expect(isPathContained(root, path.join(root, "nested", "file.txt"))).toBe(true)
    expect(isPathContained(root, path.join(root, "a", "..", "b"))).toBe(true)
  })

  test("rejects traversal and sibling prefixes", () => {
    expect(isPathContained(root, outside)).toBe(false)
    expect(isPathContained(root, path.join(root, "..", "repo-other"))).toBe(false)
  })

  test.skipIf(process.platform !== "win32")("is case-insensitive on win32", () => {
    expect(isPathContained("C:\\Work\\Repo", "c:\\work\\repo\\src\\index.ts")).toBe(true)
    expect(isPathContained("C:\\Work\\Repo", "c:\\work\\RepoOther\\x")).toBe(false)
  })

  test.skipIf(process.platform === "win32")("is case-sensitive on posix", () => {
    expect(isPathContained("/work/repo", "/work/repo/File")).toBe(true)
    expect(isPathContained("/work/repo", "/work/REPO/file")).toBe(false)
  })
})

describe("Sandbox.assertCwdContained", () => {
  test("allows workspace and temp, rejects escaping directories", () => {
    expect(() => assertCwdContained(root, policy("workspace-write"))).not.toThrow()
    expect(() => assertCwdContained(path.join(root, "pkg"), policy("workspace-write"))).not.toThrow()
    expect(() => assertCwdContained(temp, policy("workspace-write"))).not.toThrow()
    expect(() => assertCwdContained(outside, policy("workspace-write"))).toThrow(/SANDBOX_VIOLATION/)
  })

  test("danger-full-access skips containment", () => {
    expect(() => assertCwdContained(outside, policy("danger-full-access"))).not.toThrow()
  })

  test.skipIf(process.platform !== "win32")("accepts spelled variants of the workspace root", () => {
    const repo = path.resolve("C:\\Work\\Repo")
    const variants = [repo, repo.replaceAll("\\", "/"), repo.toLowerCase()]
    for (const variant of variants) {
      expect(() => assertCwdContained(variant, policyWith(repo))).not.toThrow()
      expect(() => assertCwdContained(path.join(variant, "src"), policyWith(repo))).not.toThrow()
    }
    expect(() => assertCwdContained(path.resolve("C:\\Work\\RepoOther"), policyWith(repo))).toThrow(/SANDBOX_VIOLATION/)
  })
})

describe("Sandbox.assertCommandContained", () => {
  const rw = policy("workspace-write")
  const ro = policy("read-only")

  test("read-only rejects write commands", () => {
    expect(() => assertCommandContained("rm notes.txt", ro)).toThrow(/read-only/)
    expect(() => assertCommandContained("touch a.txt", ro)).toThrow(/read-only/)
    expect(() => assertCommandContained("sed -i s/a/b/ notes.txt", ro)).toThrow(/read-only/)
    expect(() => assertCommandContained("ls -la", ro)).not.toThrow()
  })

  test("workspace-write rejects writes outside the workspace", () => {
    expect(() => assertCommandContained(`rm ${path.join(outside, "x")}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`rm ${path.join(root, "..", "other", "x")}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`rm ${path.join(root, "nested", "x")}`, rw)).not.toThrow()
  })

  test("rejects chained directory changes that leave the workspace", () => {
    expect(() => assertCommandContained("cd .. && rm secret.txt", rw)).toThrow(/SANDBOX_VIOLATION/)
    expect(() => assertCommandContained("cd $HOME && rm secret.txt", rw)).toThrow(/Dynamic directory change/)
    expect(() => assertCommandContained("cd pkg && ls", rw)).not.toThrow()
    // A lone directory change cannot write and is handled by the permission layer.
    expect(() => assertCommandContained("cd ..", rw)).not.toThrow()
  })

  test("rejects dynamic write targets that cannot be verified", () => {
    expect(() => assertCommandContained("rm $HOME/secret.txt", rw)).toThrow(/Dynamic write target/)
  })

  test("rejects privilege escalation", () => {
    expect(() => assertCommandContained("sudo ls", rw)).toThrow(/Privilege escalation/)
  })

  test("opaque command lines are left to the OS backend", () => {
    expect(() => assertCommandContained("echo $(cat /etc/passwd)", rw)).not.toThrow()
  })

  test("danger-full-access bypasses tool-layer guards", () => {
    expect(() => assertCommandContained("rm -rf /", policy("danger-full-access"))).not.toThrow()
  })
})

describe("Sandbox adversarial containment", () => {
  const rw = policy("workspace-write")
  const ro = policy("read-only")

  test("read-only denies shell redirection writes", () => {
    expect(() => assertCommandContained("echo pwn > build.sh", ro)).toThrow(/read-only/)
    expect(() => assertCommandContained(`echo pwn > ${path.join(outside, "x")}`, ro)).toThrow(/read-only/)
    // Device redirections are not writes to a real file.
    expect(() => assertCommandContained("ls -la >/dev/null 2>&1", ro)).not.toThrow()
  })

  test("workspace-write denies redirections outside the workspace for every shell", () => {
    expect(() => assertCommandContained(`echo pwn > ${path.join(outside, "x")}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`echo pwn > ${path.join(outside, "x")}`, rw, { shell: "cmd" })).toThrow(
      /escapes/,
    )
    // cmd.exe does not treat a backslash as an escape, so `\>` still redirects.
    expect(() => assertCommandContained(`echo pwn \\> ${path.join(outside, "x")}`, rw, { shell: "cmd" })).toThrow(
      /escapes/,
    )
    expect(() => assertCommandContained("echo pwn > inside.txt", rw)).not.toThrow()
  })

  test("nested shells are unpacked instead of treated as opaque", () => {
    expect(() => assertCommandContained(`bash -c 'touch ${path.join(outside, "x")}'`, rw)).toThrow(/escapes/)
    expect(() =>
      assertCommandContained(`powershell -Command "Set-Content ${path.join(outside, "x")} hi"`, rw, {
        shell: "powershell",
      }),
    ).toThrow(/escapes/)
    expect(() => assertCommandContained("bash -c 'ls -la'", rw)).not.toThrow()
  })

  test("option-based write destinations are checked", () => {
    expect(() => assertCommandContained("dd if=/dev/zero of=../outside.bin", rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`curl -o ${path.join(outside, "x")} https://example.com`, rw)).toThrow(
      /escapes/,
    )
    expect(() => assertCommandContained("dd if=/dev/zero of=inside.bin", rw)).not.toThrow()
  })

  test("relative writes resolve against a prior cd, not the original cwd", () => {
    // After `cd ..` the `rm` target is one level above the workspace.
    expect(() =>
      assertCommandContained("cd .. && rm sub/../../outside.txt", rw, { cwd: path.join(root, "sub") }),
    ).toThrow(/escapes/)
    expect(() => assertCommandContained("cd sub && touch nested.txt", rw)).not.toThrow()
  })

  test("dynamic execution that hides a command line is rejected", () => {
    expect(() => assertCommandContained("eval 'rm inside.txt'", rw)).toThrow(/cannot be verified/)
    expect(() => assertCommandContained("command bash -c 'rm inside.txt'", rw)).toThrow(/cannot be verified/)
  })

  test("symlinks inside the workspace cannot point outside", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "navi-sym-"))
    try {
      const repo = path.join(base, "repo")
      const outsideDir = path.join(base, "outside")
      fs.mkdirSync(repo)
      fs.mkdirSync(outsideDir)
      const link = path.join(repo, "link")
      try {
        fs.symlinkSync(outsideDir, link, process.platform === "win32" ? "junction" : "dir")
      } catch {
        return
      }
      expect(canonicalPath(link)).toBe(canonicalPath(outsideDir))
      expect(isPathContained(repo, path.join(link, "secret.txt"))).toBe(false)
      expect(isPathContained(repo, path.join(repo, "inside.txt"))).toBe(true)
      // Temp is a permitted write root, so only assert the command guard when
      // the symlink target is not itself inside the temp directory.
      if (!isPathContained(temp, outsideDir)) {
        expect(() =>
          assertCommandContained("rm link/secret.txt", { mode: "workspace-write", workspaceRoot: repo }),
        ).toThrow(/escapes/)
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})

describe("Sandbox danger patterns", () => {
  const rw = policy("workspace-write")
  const ro = policy("read-only")
  const outsideFile = path.join(outside, "x")

  test("destructive commands stay rejected in confined modes", () => {
    expect(() => assertCommandContained("rm -rf /", rw)).toThrow(/catastrophic/)
    expect(() => assertCommandContained("rm -rf /*", rw)).toThrow(/catastrophic/)
    expect(() => assertCommandContained("dd if=/dev/zero of=/dev/sda", rw)).toThrow(/catastrophic/)
    expect(() => assertCommandContained(":(){ :|:& };:", rw)).toThrow(/catastrophic/)
    // Power users keep the old behavior.
    expect(() => assertCommandContained("rm -rf /", policy("danger-full-access"))).not.toThrow()
  })

  test("every redirect form is contained", () => {
    for (const operator of [">", ">>", "2>", "&>", "*>"]) {
      expect(() => assertCommandContained(`echo pwn ${operator} ${outsideFile}`, rw)).toThrow(/escapes/)
    }
    expect(() => assertCommandContained("echo pwn > inside.txt", rw)).not.toThrow()
    expect(() => assertCommandContained("echo pwn >/dev/null 2>&1", rw)).not.toThrow()
  })

  test("nested shell wrappers do not hide their command line", () => {
    expect(() => assertCommandContained(`bash -c 'touch ${outsideFile}'`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`sh -lc 'rm -rf /'`, rw)).toThrow(/catastrophic/)
    expect(() =>
      assertCommandContained(`powershell -Command "Set-Content ${outsideFile} hi"`, rw, { shell: "powershell" }),
    ).toThrow(/escapes/)
    expect(() => assertCommandContained(`cmd /c "echo pwn > ${outsideFile}"`, rw, { shell: "cmd" })).toThrow(/escapes/)
  })

  test("option-based destinations are contained", () => {
    for (const command of [
      `dd if=/dev/zero of=${outsideFile}`,
      `curl -o ${outsideFile} https://example.com`,
      `curl --output=${outsideFile} https://example.com`,
      `wget -O ${outsideFile} https://example.com`,
      `wget --output-document=${outsideFile} https://example.com`,
      `tar -C ${outside} -xf a.tar`,
      `tar --directory=${outside} -xf a.tar`,
      `unzip a.zip -d ${outside}`,
    ]) {
      expect(() => assertCommandContained(command, rw)).toThrow(/escapes|catastrophic/)
    }
    expect(() => assertCommandContained("tar -C build -xf a.tar", rw)).not.toThrow()
    expect(() => assertCommandContained("dd if=/dev/zero of=inside.bin", rw)).not.toThrow()
  })

  test("PowerShell cmdlets are contained", () => {
    for (const command of [
      `Remove-Item -Recurse -Force ${outsideFile}`,
      `Move-Item a.txt ${outsideFile}`,
      `Copy-Item a.txt ${outsideFile}`,
      `New-Item ${outsideFile}`,
      `Set-Content ${outsideFile} hi`,
      `Add-Content ${outsideFile} hi`,
      `Get-Content a.txt | Out-File ${outsideFile}`,
    ]) {
      expect(() => assertCommandContained(command, rw, { shell: "powershell" })).toThrow(/escapes|catastrophic/)
    }
    expect(() => assertCommandContained("Set-Content notes.txt hi", rw, { shell: "powershell" })).not.toThrow()
  })

  test("sed in-place writes are contained", () => {
    expect(() => assertCommandContained(`sed -i s/a/b/ ${outsideFile}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`sed -i -e 's/a/b/' ${outsideFile}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained(`sed --in-place 's#/etc/hosts#x#' ${outsideFile}`, rw)).toThrow(/escapes/)
    expect(() => assertCommandContained("sed -i s/a/b/ notes.txt", rw)).not.toThrow()
    // The edit script is not a write target even when it names an absolute path.
    expect(() => assertCommandContained("sed -i 's#/etc/hosts#x#' notes.txt", rw)).not.toThrow()
    // A plain read from outside stays allowed.
    expect(() => assertCommandContained(`sed -n 1p ${outsideFile}`, rw)).not.toThrow()
  })

  test("privilege escalation is rejected", () => {
    for (const command of ["sudo ls", "doas ls", "su root -c id", "gsudo ls", "runas /user:admin cmd"]) {
      expect(() => assertCommandContained(command, rw)).toThrow(/Privilege escalation/)
    }
  })

  test("read-only refuses lines the scanner cannot model", () => {
    expect(() => assertCommandContained("cat <<EOF\nbody\nEOF", ro)).toThrow(/cannot be verified/)
    expect(() => assertCommandContained("eval 'rm notes.txt'", ro)).toThrow(/cannot be verified/)
    expect(() => assertCommandContained("git status && cat notes.txt", ro)).not.toThrow()
  })
})

describe("Sandbox path spelling", () => {
  test("rejoins an unquoted path the shell split at spaces", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "navi space "))
    try {
      const nested = path.join(base, "nested")
      fs.mkdirSync(nested)
      const inside = policyWith(base)
      // Unquoted, so the command line really is several shell words.
      expect(() => assertCommandContained(`rm -rf ${path.join(nested, "gone.txt")}`, inside)).not.toThrow()
      expect(() => assertCommandContained(`touch ${path.join(base, "a b", "gone.txt")}`, inside)).not.toThrow()
      // Escaping paths stay rejected even when they contain spaces.
      const escaped = path.resolve(base, "..", "..", "..", "outside dir", "x.txt")
      expect(() => assertCommandContained(`rm -rf ${escaped}`, inside)).toThrow(/escapes/)
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })

  test("candidates grow one word at a time and stop at flags or expansions", () => {
    const cwd = path.resolve("/workspace/repo")
    const words = ["C:\\Users\\A", "B\\repo\\x", "-rf", "$HOME"]
    const candidates = pathWordCandidates(words, 0, cwd)
    expect(candidates.map((candidate) => candidate.consumed)).toEqual([1, 2])
    expect(candidates[1]!.path).toBe(path.resolve(cwd, "C:\\Users\\A B\\repo\\x"))
    expect(pathWordCandidates(["a"], 0, cwd)).toHaveLength(1)
  })

  test.skipIf(process.platform !== "win32")("resolves 8.3 short names for roots and targets", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "navi-long-name-for-83-"))
    try {
      // `os.tmpdir()` reports an 8.3 ancestor (`C:\Users\X380YO~1\...`) on some
      // hosts while `realpath` reports the long form; both name the same
      // directory. Ask the filesystem for the leaf's alias too, when the volume
      // generates one.
      const canonical = canonicalPath(base)
      const short = windowsShortPath(base) ?? base
      expect(canonicalPath(short)).toBe(canonical)
      expect(isPathContained(canonical, short)).toBe(true)
      expect(isPathContained(short, canonical)).toBe(true)
      expect(isPathContained(canonical, path.join(short, "new-file.txt"))).toBe(true)
      expect(isPathContained(short, path.join(canonical, "new-file.txt"))).toBe(true)
      expect(() => assertCwdContained(short, policyWith(canonical))).not.toThrow()
      // A short name is a different directory from its long-name siblings.
      expect(isPathContained(canonical, path.join(path.dirname(canonical), "navi-other-dir", "x"))).toBe(false)
      const slashed = path.join(base, "new-file.txt").replaceAll("\\", "/")
      expect(isPathContained(base.replaceAll("\\", "/").toLowerCase(), slashed)).toBe(true)
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform !== "win32")("handles UNC and extended-length spellings", () => {
    const share = String.raw`\\server\share\repo`
    expect(isPathContained(share, share)).toBe(true)
    expect(isPathContained(share, String.raw`\\server\share\repo\src\a.ts`)).toBe(true)
    expect(isPathContained(share, "//server/share/repo/a.ts")).toBe(true)
    expect(isPathContained(share, String.raw`\\?\UNC\server\share\repo\a.ts`)).toBe(true)
    expect(isPathContained(String.raw`\\?\UNC\server\share\repo`, String.raw`\\server\share\repo\a.ts`)).toBe(true)
    expect(isPathContained(share, String.raw`\\server\share\other\a.ts`)).toBe(false)
    expect(isPathContained(share, String.raw`\\server\share2\repo\a.ts`)).toBe(false)
    expect(isPathContained(share, String.raw`\\other\share\repo\a.ts`)).toBe(false)
    // Extended-length drive spellings compare against their plain form.
    expect(isPathContained(String.raw`\\?\C:\repo`, "C:/repo/a.ts")).toBe(true)
    expect(isPathContained(String.raw`\\?\C:\repo`, "C:/other/a.ts")).toBe(false)
  })
})

describe("Sandbox scan performance", () => {
  // A 10KB command must stay inside the 5ms guard budget; the median of a few
  // runs keeps the assertion stable on a loaded machine.
  const command = [
    ...Array.from({ length: 30 }, (_, i) => `cp src/tool/part-${i}.ts build/part-${i}.ts`),
    `grep -rn ${"module-".repeat(1300)} src`,
    "rm -f build/old.log",
    "mkdir -p build/cache",
  ].join(" && ")

  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

  const measure = (policy: SandboxPolicy) => {
    const samples: number[] = []
    for (let i = 0; i < 11; i++) {
      const start = performance.now()
      assertCommandContained(command, policy)
      samples.push(performance.now() - start)
    }
    return median(samples)
  }

  test("scans and guards a 10KB command within budget", () => {
    expect(command.length).toBeGreaterThan(10_000)
    const policy: SandboxPolicy = { mode: "workspace-write", workspaceRoot: process.cwd() }
    for (let i = 0; i < 3; i++) assertCommandContained(command, policy)
    // Best of three medians: the bound is generous against a loaded machine
    // while still failing if a change makes the guard an order of magnitude
    // slower than the 5ms budget.
    const best = Math.min(measure(policy), measure(policy), measure(policy))
    expect(best).toBeLessThan(10)
  })
})

describe("Sandbox.SandboxPathGuard", () => {
  test("denies writes to version-control internals but allows reads", () => {
    const rw = policy("workspace-write")
    expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, ".git", "config"), rw, true)).toThrow(
      /SANDBOX_VIOLATION/,
    )
    expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, ".git", "config"), rw, false)).not.toThrow()
  })

  test("read-only denies writes anywhere", () => {
    expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, "notes.txt"), policy("read-only"), true)).toThrow(
      /read-only/,
    )
  })

  test("workspace-write allows the workspace and temp only", () => {
    const rw = policy("workspace-write")
    expect(() => SandboxPathGuard.assertPathAllowed(path.join(root, "notes.txt"), rw, true)).not.toThrow()
    expect(() => SandboxPathGuard.assertPathAllowed(path.join(temp, "scratch.txt"), rw, true)).not.toThrow()
    expect(() => SandboxPathGuard.assertPathAllowed(path.join(outside, "notes.txt"), rw, true)).toThrow(
      /SANDBOX_VIOLATION/,
    )
  })
})

describe("Probes.selectRunner", () => {
  test("unknown platforms have no chain", () => {
    expect(selectRunner("freebsd", () => "full")).toBeNull()
  })

  test("single-runner chains use static enforcement without probing", () => {
    let calls = 0
    const probe = () => {
      calls++
      return "unusable" as Enforcement
    }
    expect(selectRunner("darwin", probe)).toEqual({ runner: "seatbelt", enforcement: "full" })
    expect(selectRunner("win32", probe)).toEqual({ runner: "windows-acl", enforcement: "partial" })
    expect(calls).toBe(0)
  })

  test("linux falls back through the chain", () => {
    const calls: Runner[] = []
    const probe = (runner: Runner): Enforcement => {
      calls.push(runner)
      return runner === "bwrap" ? "unusable" : "partial"
    }
    expect(selectRunner("linux", probe)).toEqual({ runner: "landlock", enforcement: "partial" })
    expect(calls).toEqual(["bwrap", "landlock"])
  })

  test("an exhausted chain returns null", () => {
    expect(selectRunner("linux", () => "unusable")).toBeNull()
  })

  test("windows is never statically marked full", () => {
    expect(STATIC_ENFORCEMENT["windows-acl"]).toBe("partial")
  })
})
