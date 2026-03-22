import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.NAVI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

type BashRisk = "low" | "medium" | "high" | "critical"

function summarizeBashCommand(command: string): {
  command: string
  summary: string
  risk: BashRisk
  destructive: boolean
  warnings: string[]
} {
  const normalized = command.trim()
  const tokens = normalized.split(/\s+/).filter(Boolean)
  const commandName = BashArity.prefix(tokens).join(" ") || tokens[0] || normalized
  const lower = normalized.toLowerCase()
  const warnings: string[] = []

  let risk: BashRisk = "low"
  let destructive = false
  let summary = commandName

  if (/^(rm|rmdir)\b/i.test(lower) || /^git\s+clean\b.*-f/i.test(lower) || /^git\s+reset\b.*--hard\b/i.test(lower) || /^git\s+push\b.*--force/i.test(lower) || /^dd\b/i.test(lower) || /^mkfs/i.test(lower) || /^shutdown\b/i.test(lower) || /^reboot\b/i.test(lower)) {
    risk = "critical"
    destructive = true
    summary = `destructive command: ${commandName}`
    warnings.push("Can delete, overwrite, or irreversibly change files or system state")
  } else if (/^(mv|cp|mkdir|touch|chmod|chown)\b/i.test(lower) || /^git\s+(commit|merge|rebase|am|tag)\b/i.test(lower)) {
    risk = "high"
    destructive = true
    summary = `filesystem change: ${commandName}`
    warnings.push("Will modify project files or repository state")
  } else if (/^(?:bun|npm|pnpm|yarn|pip|poetry|cargo|go|mvn|gradle)\s+(?:install|add|update|upgrade)\b/i.test(lower)) {
    risk = "medium"
    summary = `dependency install: ${commandName}`
    warnings.push("May update lockfiles, downloaded packages, or dependency state")
  } else if (/^(?:bun|npm|pnpm|yarn)\s+(?:test|run\s+test|lint|run\s+lint|build|run\s+build)\b/i.test(lower) || /\b(?:test|lint|build|debug)\b/i.test(lower)) {
    risk = "low"
    summary = `workflow command: ${commandName}`
    warnings.push("May run for a long time or emit large output")
  }

  return {
    command: commandName,
    summary,
    risk,
    destructive,
    warnings,
  }
}

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
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
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      let commandToRun = params.command

      // Git Attribution: Append Co-authored-by to git commit commands
      if (commandToRun.includes("git commit") && !commandToRun.includes("Co-authored-by")) {
        const attribution = "\n\nCo-authored-by: Navi <navi@navi-ai.io>"
        // Handle -m "message" or -m 'message'
        if (commandToRun.includes("-m")) {
          commandToRun = commandToRun.replace(/(-m\s+["'])([^"']+)(["'])/, `$1$2${attribution}$3`)
        } else if (!commandToRun.includes("--amend")) {
          // If no -m and not amend, it likely opens an editor. 
          // We can't easily append to the editor, but we can add it to the command if it's a simple commit
          // For now, only handle -m which is most common for agents
        }
      }

      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()
      const commandSummaries: ReturnType<typeof summarizeBashCommand>[] = []
      let overallRisk: BashRisk = "low"

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue
        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await $`realpath ${arg}`
              .cwd(cwd)
              .quiet()
              .nothrow()
              .text()
              .then((x) => x.trim())
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              // Git Bash on Windows returns Unix-style paths like /c/Users/...
              const normalized =
                process.platform === "win32" && resolved.match(/^\/[a-z]\//)
                  ? resolved.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\")
                  : resolved
              if (!Instance.containsPath(normalized)) directories.add(normalized)
            }
          }
        }

        const commandSummary = summarizeBashCommand(command.join(" "))
        commandSummaries.push(commandSummary)
        if (commandSummary.risk === "critical") overallRisk = "critical"
        else if (commandSummary.risk === "high" && overallRisk !== "critical") overallRisk = "high"
        else if (commandSummary.risk === "medium" && overallRisk === "low") overallRisk = "medium"

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(command.join(" "))
          always.add(BashArity.prefix(command).join(" ") + "*")
        }
      }

      if (directories.size > 0) {
        await ctx.ask({
          permission: "external_directory",
          patterns: Array.from(directories),
          always: Array.from(directories).map((x) => path.dirname(x) + "*"),
          metadata: {
            cwd,
            paths: Array.from(directories),
            risk: directories.size > 0 ? "medium" : "low",
            summary: directories.size > 0 ? "Access external files or directories outside the current project" : undefined,
          },
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {
            command: params.command,
            cwd,
            summary:
              commandSummaries.length > 0
                ? commandSummaries.map((item) => item.summary).join(" ; ")
                : params.description,
            risk: overallRisk,
            destructive: commandSummaries.some((item) => item.destructive),
            warnings: commandSummaries.flatMap((item) => item.warnings),
            targets: Array.from(directories),
            commands: commandSummaries.map((item) => item.command),
          },
        })
      }

      const proc = spawn(params.command, {
        shell,
        cwd,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
