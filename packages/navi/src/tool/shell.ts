import { Effect, Option, Stream } from "effect"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import * as Log from "@navi-ai/core/util/log"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@navi-ai/core/filesystem"
import { fileURLToPath } from "url"
import { Config } from "@/config/config"
import { Flag } from "@navi-ai/core/flag/flag"
import { Shell } from "@/shell/shell"
import { ShellID } from "./shell/id"

import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ShellPrompt, type Parameters } from "./shell/prompt"
import { BashArity } from "@/permission/arity"
import { PermissionModeManager } from "@/permission/mode"
import { Permission } from "@/permission"
import { Sandbox, type ConfinedExecution, type SandboxPolicy } from "@/sandbox"

export { Parameters } from "./shell/prompt"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.NAVI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const CMD_FILES = new Set([
  "copy",
  "del",
  "dir",
  "erase",
  "md",
  "mkdir",
  "move",
  "rd",
  "ren",
  "rename",
  "rmdir",
  "type",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

type Chunk = {
  text: string
  size: number
}

export const log = Log.create({ service: "shell-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function parts(node: Node) {
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    const kind = match[1]
    const rest = match[2]
    if (kind?.toLowerCase() !== "filesystem") return
    return rest
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if ((prefix[1]?.length ?? 0) === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean, cmd = false) {
  if (!ps) {
    return list
      .slice(1)
      .filter(
        (item) =>
          !item.text.startsWith("-") &&
          !(cmd && item.text.startsWith("/")) &&
          !(list[0]?.text === "chmod" && item.text.startsWith("+")),
      )
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const totalBytes = Buffer.byteLength(text, "utf-8")
  if (totalBytes <= maxBytes) {
    let lineCount = 1
    let idx = text.indexOf("\n")
    while (idx !== -1) {
      lineCount++
      if (lineCount > maxLines) break
      idx = text.indexOf("\n", idx + 1)
    }
    if (lineCount <= maxLines) {
      return {
        text,
        cut: false,
      }
    }
  }

  const out: string[] = []
  let bytes = 0
  let end = text.length

  while (end > 0 && out.length < maxLines) {
    const prevNewline = text.lastIndexOf("\n", end - 1)
    const line = prevNewline === -1 ? text.slice(0, end) : text.slice(prevNewline + 1, end)
    const size = Buffer.byteLength(line, "utf-8") + (out.length > 0 ? 1 : 0)

    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(line, "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && ((buf[start] ?? 0) & 0xc0) === 0x80) start++
        out.push(buf.subarray(start).toString("utf-8"))
      }
      break
    }

    out.push(line)
    bytes += size
    if (prevNewline === -1) break
    end = prevNewline
  }

  out.reverse()
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const parse = Effect.fn("ShellTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree
})

const ask = Effect.fn("ShellTool.ask")(function* (ctx: Tool.Context, scan: Scan) {
  if (scan.dirs.size > 0) {
    const globs = Array.from(scan.dirs).map((dir) => {
      if (process.platform === "win32") return AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      return path.join(dir, "*")
    })
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {},
    })
  }

  if (scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: ShellID.ToolID,
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {},
  })
})

// The argv a shell needs to run `command` non-interactively. Mirrors the `shell`
// option that `ChildProcess.make` used before the sandbox wrapper existed.
function shellArgs(shell: string, command: string) {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
  }
  if (Shell.posix(shell)) return ["-c", command]
  return ["/d", "/s", "/c", command]
}

function cmd(confined: ConfinedExecution, shell: string, command: string, cwd: string) {
  // No OS wrapper was applied (danger-full-access or the Windows tool-layer
  // guard): keep the original spawn shape so quoting semantics stay identical.
  if (confined.command === shell) {
    if (process.platform === "win32" && Shell.ps(shell)) {
      return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
        cwd,
        env: confined.env,
        stdin: "ignore",
        detached: false,
      })
    }

    return ChildProcess.make(command, [], {
      shell,
      cwd,
      env: confined.env,
      stdin: "ignore",
      detached: process.platform !== "win32",
    })
  }

  // seatbelt/bwrap rewrote argv to launcher + profile/flags + shell + command.
  return ChildProcess.make(confined.command, confined.args, {
    cwd,
    env: confined.env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

export const ShellTool = Tool.define(
  ShellID.ToolID,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service

    const cygpath = Effect.fn("ShellTool.cygpath")(function* (shell: string, text: string) {
      const lines = yield* spawner
        .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const file = lines[0]?.trim()
      if (!file) return
      return AppFileSystem.normalizePath(file)
    })

    // Roots the msys runtime maps into its own tree, so `/tmp` means the
    // emulated temp dir rather than `C:\tmp`. Everything else that starts with
    // a slash but has no drive is a drive-root path (`/Users/me/repo`).
    const MSYS_ROOTS = new Set([
      "tmp",
      "usr",
      "bin",
      "sbin",
      "etc",
      "home",
      "dev",
      "proc",
      "var",
      "opt",
      "lib",
      "mingw32",
      "mingw64",
    ])

    const resolvePath = Effect.fn("ShellTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform !== "win32") return path.resolve(root, text)
      const windows = AppFileSystem.windowsPath(text)
      if (Shell.posix(shell) && text.startsWith("/") && windows === text) {
        // Prefer the drive root when that directory exists; otherwise ask the
        // shell's mount table so `/tmp` keeps its Git Bash semantics.
        const drive = AppFileSystem.normalizePath(path.join(path.parse(root).root, text))
        const emulated = MSYS_ROOTS.has(text.split("/")[1]?.toLowerCase() ?? "")
        if (!emulated && (yield* fs.existsSafe(drive))) return drive
        const file = yield* cygpath(shell, text)
        if (file) return file
      }
      return AppFileSystem.normalizePath(path.resolve(root, windows))
    })

    const argText = (arg: string, cwd: string, ps: boolean, shell: string) => {
      const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
      const file = text && prefix(text)
      if (!file || dynamic(file, ps)) return
      return ps ? provider(file) : file
    }

    const firstExisting = Effect.fn("ShellTool.firstExisting")(function* (
      candidates: Array<{ path: string; consumed: number }>,
    ) {
      for (const candidate of candidates) {
        if (yield* fs.existsSafe(candidate.path)) return candidate
      }
    })

    const collect = Effect.fn("ShellTool.collect")(function* (
      root: Node,
      cwd: string,
      ps: boolean,
      shell: string,
      instance: InstanceContext,
    ) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
      }
      const shellKind = ShellID.toKind(Shell.name(shell))

      for (const node of commands(root)) {
        const command = parts(node)
        const tokens = command.map((item) => item.text)
        const cmd = ps || shellKind === "cmd" ? tokens[0]?.toLowerCase() : tokens[0]

        if (cmd && (FILES.has(cmd) || (shellKind === "cmd" && CMD_FILES.has(cmd)))) {
          const args = pathArgs(command, ps, shellKind === "cmd")
            .map((arg) => argText(arg, cwd, ps, shell))
            .filter((text): text is string => Boolean(text))
          for (let index = 0; index < args.length; ) {
            // A path with spaces is split into several shell words, so resolve
            // every rejoin and use the first one inside the project boundary.
            const candidates: Array<{ path: string; consumed: number }> = []
            for (const candidate of Sandbox.pathWordCandidates(args, index, cwd)) {
              candidates.push({ path: yield* resolvePath(candidate.text, cwd, shell), consumed: candidate.consumed })
            }
            // Outside the project the intended path is the rejoin that exists,
            // not the truncated prefix (which would ask for a far wider glob).
            const chosen =
              candidates.find((item) => containsPath(item.path, instance)) ??
              (candidates.length > 1 ? yield* firstExisting(candidates) : undefined) ??
              candidates[0]!
            log.info("resolved path", { arg: args[index], resolved: chosen.path })
            index += chosen.consumed
            if (containsPath(chosen.path, instance)) continue
            const dir = (yield* fs.isDir(chosen.path)) ? chosen.path : path.dirname(chosen.path)
            scan.dirs.add(dir)
          }
        }

        if (tokens.length && (!cmd || !CWD.has(cmd))) {
          scan.patterns.add(source(node))
          scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
        }
      }

      return scan
    })

    const shellEnv = Effect.fn("ShellTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const { sanitizeChildProcessEnv } = yield* Effect.promise(() => import("@/util/sanitize-env"))
      return sanitizeChildProcessEnv({
        ...process.env,
        ...extra.env,
      })
    })

    const run = Effect.fn("ShellTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        policy: SandboxPolicy
        timeout: number
        description: string
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      let full = ""
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false

      yield* ctx.metadata({
        metadata: {
          output: "",
          description: input.description,
        },
      })

      const code: number | null = yield* Effect.scoped(
        Effect.gen(function* () {
          const confined = yield* Effect.try({
            try: () => Sandbox.confineSync(input.shell, shellArgs(input.shell, input.command), input.policy, input.env),
            catch: (cause) => cause,
          }).pipe(Effect.orDie)
          const handle = yield* spawner.spawn(cmd(confined, input.shell, input.command, input.cwd))

          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
              const size = Buffer.byteLength(chunk, "utf-8")
              list.push({ text: chunk, size })
              used += size
              while (used > keep && list.length > 1) {
                const item = list.shift()
                if (!item) break
                used -= item.size
                cut = true
              }

              last = preview(last + chunk)

              if (file) {
                sink?.write(chunk)
              } else {
                full += chunk
                if (Buffer.byteLength(full, "utf-8") > limits.maxBytes) {
                  return trunc.write(full).pipe(
                    Effect.andThen((next) =>
                      Effect.sync(() => {
                        file = next
                        cut = true
                        sink = createWriteStream(next, { flags: "a" })
                        full = ""
                      }),
                    ),
                    Effect.andThen(
                      ctx.metadata({
                        metadata: {
                          output: last,
                          description: input.description,
                        },
                      }),
                    ),
                  )
                }
              }

              return ctx.metadata({
                metadata: {
                  output: last,
                  description: input.description,
                },
              })
            }),
          )

          const abort = Effect.callback<void>((resume) => {
            if (ctx.abort.aborted) return resume(Effect.void)
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
          })

          const timeout = Effect.sleep(`${input.timeout + 100} millis`)

          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
            timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            aborted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }

          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

      const meta: string[] = []
      if (expired) {
        meta.push(
          `shell tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
        )
      }
      if (aborted) meta.push("User aborted the command")
      const raw = list.map((item) => item.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) {
        file = yield* trunc.write(raw)
      }

      let output = end.text
      if (!output) output = "(no output)"

      if (cut && file) {
        output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      }

      if (meta.length > 0) {
        output += "\n\n<shell_metadata>\n" + meta.join("\n") + "\n</shell_metadata>"
      }
      if (sink) {
        const stream = sink
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              stream.end(() => resolve())
              stream.on("error", () => resolve())
            }),
        )
      }

      return {
        title: input.description,
        metadata: {
          output: last || preview(output),
          exit: code,
          description: input.description,
          truncated: cut,
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
    })

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = Shell.acceptable(cfg.shell)
        const name = Shell.name(shell)
        const limits = yield* trunc.limits()
        const prompt = ShellPrompt.render(name, process.platform, limits)
        log.info("shell tool using shell", { shell })

        return {
          description: prompt.description,
          parameters: prompt.parameters,
          execute: (params: Parameters, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const executeInstance = yield* InstanceState.context
              const cwd = params.workdir
                ? yield* resolvePath(params.workdir, executeInstance.directory, shell)
                : executeInstance.directory
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }
              const timeout = params.timeout ?? DEFAULT_TIMEOUT
              const ps = Shell.ps(shell)
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const tree = yield* Effect.acquireRelease(parse(params.command, ps), (tree) =>
                    Effect.sync(() => tree.delete()),
                  )
                  const scan = yield* collect(tree.rootNode, cwd, ps, shell, executeInstance)
                  if (!containsPath(cwd, executeInstance)) scan.dirs.add(cwd)
                  yield* ask(ctx, scan)
                }),
              )

              // Force the permission state to initialise so the mode configured
              // for this instance (permission.mode) is applied before the
              // sandbox policy is derived. `ask` above is skipped for commands
              // without file patterns, so it cannot be relied on for this.
              const permission = yield* Effect.serviceOption(Permission.Service)
              if (Option.isSome(permission)) yield* permission.value.list()

              const policy: SandboxPolicy = {
                mode: Sandbox.resolveMode(
                  PermissionModeManager.getMode(executeInstance.directory),
                  process.env.NAVI_SANDBOX_MODE,
                ),
                // Confine to the repository root when there is one; a non-git
                // instance reports "/" as its worktree, so fall back to the
                // working directory.
                workspaceRoot: executeInstance.worktree === "/" ? executeInstance.directory : executeInstance.worktree,
              }
              const shellKind = ps ? "powershell" : Shell.posix(shell) ? "bash" : "cmd"
              yield* Effect.sync(() => {
                Sandbox.assertCwdContained(cwd, policy)
                Sandbox.assertCommandContained(params.command, policy, { cwd, shell: shellKind })
              })

              return yield* run(
                {
                  shell,
                  command: params.command,
                  cwd,
                  env: yield* shellEnv(ctx, cwd),
                  policy,
                  timeout,
                  description: params.description,
                },
                ctx,
              )
            }),
        }
      })
  }),
)
