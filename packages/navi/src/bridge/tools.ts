import * as fs from "fs/promises"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { z } from "zod"
import { SandboxPathGuard, DestructiveCommandGuard, confineSync } from "@/sandbox"
import * as Log from "@navi-ai/core/util/log"

const execFileAsync = promisify(execFile)
const log = Log.create({ service: "bridge.tools" })

const ALLOWED_TEST_RUNNERS = [
  /^bun\s+test(\s+.*)?$/,
  /^(npm|pnpm|yarn)\s+(test|run\s+test)(\s+.*)?$/,
  /^cargo\s+test(\s+.*)?$/,
  /^pytest(\s+.*)?$/,
  /^python(\d+(\.\d+)?)?\s+-m\s+(pytest|unittest)(\s+.*)?$/,
  /^go\s+test(\s+.*)?$/,
  /^(vitest|jest)(\s+.*)?$/,
]

export interface ToolContext {
  workspaceRoot: string
  onActivity?: (toolName: string, args: Record<string, unknown>, result: string) => void
}

export interface BridgeToolDefinition {
  name: string
  description: string
  parameters: z.ZodObject<any>
  execute: (args: any, ctx: ToolContext) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>
}

function resolveSafePath(userPath: string, root: string, isWrite = true): string {
  const resolved = path.isAbsolute(userPath) ? path.resolve(userPath) : path.resolve(root, userPath)
  SandboxPathGuard.assertPathAllowed(resolved, { mode: "workspace-write", workspaceRoot: root }, isWrite)
  return resolved
}

export const bridgeTools: BridgeToolDefinition[] = [
  // ── 1. Files ───────────────────────────────────────────────────────────────
  {
    name: "file_read",
    description: "Read the text contents of a file within the workspace",
    parameters: z.object({
      path: z.string().describe("Relative or absolute file path to read"),
      offset: z.number().optional().describe("Starting byte offset (default: 0)"),
      limit: z.number().optional().describe("Maximum bytes to read (default: 64KB)"),
    }),
    execute: async (args, ctx) => {
      try {
        const fullPath = resolveSafePath(args.path, ctx.workspaceRoot, false)
        const content = await fs.readFile(fullPath, "utf8")
        const start = args.offset ?? 0
        const end = args.limit ? start + args.limit : content.length
        const sliced = content.slice(start, end)
        return { content: [{ type: "text", text: sliced }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Error reading file: ${String(err)}` }], isError: true }
      }
    },
  },
  {
    name: "file_write",
    description: "Create or overwrite a file within the workspace",
    parameters: z.object({
      path: z.string().describe("Relative or absolute file path to write"),
      content: z.string().describe("Complete text content to write into the file"),
    }),
    execute: async (args, ctx) => {
      try {
        const fullPath = resolveSafePath(args.path, ctx.workspaceRoot)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, args.content, "utf8")
        return { content: [{ type: "text", text: `Successfully wrote ${args.content.length} characters to ${args.path}` }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Error writing file: ${String(err)}` }], isError: true }
      }
    },
  },
  {
    name: "file_edit",
    description: "Replace a specific substring in a file with new content",
    parameters: z.object({
      path: z.string().describe("Relative or absolute file path to edit"),
      oldText: z.string().describe("Exact existing text to find and replace"),
      newText: z.string().describe("New replacement text"),
    }),
    execute: async (args, ctx) => {
      try {
        const fullPath = resolveSafePath(args.path, ctx.workspaceRoot)
        const content = await fs.readFile(fullPath, "utf8")
        if (!content.includes(args.oldText)) {
          return { content: [{ type: "text", text: `Error: 'oldText' was not found in ${args.path}` }], isError: true }
        }
        const updated = content.replace(args.oldText, args.newText)
        await fs.writeFile(fullPath, updated, "utf8")
        return { content: [{ type: "text", text: `Successfully updated ${args.path}` }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Error editing file: ${String(err)}` }], isError: true }
      }
    },
  },
  {
    name: "file_delete",
    description: "Delete a file within the workspace",
    parameters: z.object({
      path: z.string().describe("Relative or absolute file path to delete"),
    }),
    execute: async (args, ctx) => {
      try {
        const fullPath = resolveSafePath(args.path, ctx.workspaceRoot)
        await fs.unlink(fullPath)
        return { content: [{ type: "text", text: `Successfully deleted ${args.path}` }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Error deleting file: ${String(err)}` }], isError: true }
      }
    },
  },
  {
    name: "dir_list",
    description: "List directory contents with file names and subdirectory indicators",
    parameters: z.object({
      path: z.string().optional().describe("Directory path to list (defaults to workspace root)"),
    }),
    execute: async (args, ctx) => {
      try {
        const target = resolveSafePath(args.path ?? ".", ctx.workspaceRoot, false)
        const entries = await fs.readdir(target, { withFileTypes: true })
        const lines = entries.map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`))
        return { content: [{ type: "text", text: lines.join("\n") || "(empty directory)" }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Error listing directory: ${String(err)}` }], isError: true }
      }
    },
  },
  {
    name: "dir_create",
    description: "Create a directory recursively",
    parameters: z.object({
      path: z.string().describe("Directory path to create"),
    }),
    execute: async (args, ctx) => {
      try {
        const target = resolveSafePath(args.path, ctx.workspaceRoot)
        await fs.mkdir(target, { recursive: true })
        return { content: [{ type: "text", text: `Created directory ${args.path}` }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Error creating directory: ${String(err)}` }], isError: true }
      }
    },
  },

  // ── 2. Git Operations ───────────────────────────────────────────────────────
  {
    name: "git_status",
    description: "Run git status to view modified, staged, and untracked files",
    parameters: z.object({}),
    execute: async (_args, ctx) => {
      try {
        const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: ctx.workspaceRoot })
        return { content: [{ type: "text", text: stdout || "Working tree clean" }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Git error: ${String(err)}` }], isError: true }
      }
    },
  },
  {
    name: "git_diff",
    description: "Run git diff to view changes in working tree or staged commits",
    parameters: z.object({
      staged: z.boolean().optional().describe("Whether to view staged changes (--cached)"),
    }),
    execute: async (args, ctx) => {
      try {
        const cmdArgs = args.staged ? ["diff", "--cached"] : ["diff"]
        const { stdout } = await execFileAsync("git", cmdArgs, { cwd: ctx.workspaceRoot })
        return { content: [{ type: "text", text: stdout || "(no diff)" }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Git diff error: ${String(err)}` }], isError: true }
      }
    },
  },
  {
    name: "git_log",
    description: "View recent git commits",
    parameters: z.object({
      count: z.number().optional().describe("Number of commits to return (default: 10)"),
    }),
    execute: async (args, ctx) => {
      try {
        const limit = Math.max(1, Math.min(100, Math.round(Number(args.count ?? 10)) || 10))
        const { stdout } = await execFileAsync("git", ["log", "-n", String(limit), "--oneline"], {
          cwd: ctx.workspaceRoot,
        })
        return { content: [{ type: "text", text: stdout || "(no commits)" }] }
      } catch (err) {
        return { content: [{ type: "text", text: `Git log error: ${String(err)}` }], isError: true }
      }
    },
  },

  // ── 3. Terminal & Execution ────────────────────────────────────────────────
  {
    name: "command_run",
    description: "Execute a shell command locally in the workspace (safely guarded)",
    parameters: z.object({
      command: z.string().describe("The shell command line to execute"),
      cwd: z.string().optional().describe("Working directory relative to workspace root"),
    }),
    execute: async (args, ctx) => {
      try {
        // Enforce safety guards
        DestructiveCommandGuard.assertCommandSafe(args.command)
        const targetCwd = args.cwd ? resolveSafePath(args.cwd, ctx.workspaceRoot) : ctx.workspaceRoot

        const shellBin = process.platform === "win32" ? "cmd.exe" : "sh"
        const shellArgs = [process.platform === "win32" ? "/c" : "-c", args.command]
        const confined = confineSync(shellBin, shellArgs, {
          mode: "workspace-write",
          workspaceRoot: ctx.workspaceRoot,
        })

        const { stdout, stderr } = await execFileAsync(confined.command, confined.args, {
          cwd: targetCwd,
          env: { ...process.env, ...confined.env },
          maxBuffer: 4 * 1024 * 1024,
        })

        const out = [stdout.trim(), stderr ? `[stderr]\n${stderr.trim()}` : ""].filter(Boolean).join("\n\n")
        return { content: [{ type: "text", text: out || "(command exited with no output)" }] }
      } catch (err: unknown) {
        const e = err as Error & { stderr?: string }
        return {
          content: [{ type: "text", text: `Command failed: ${e.message || String(err)}\n${e.stderr || ""}` }],
          isError: true,
        }
      }
    },
  },
  {
    name: "tests_run",
    description: "Run automated test suites (e.g. bun test, npm test, cargo test, pytest)",
    parameters: z.object({
      command: z.string().optional().describe("Custom test command (defaults to auto-detecting bun test / npm test)"),
    }),
    execute: async (args, ctx) => {
      try {
        const cmd = args.command ?? (await fs.stat(path.join(ctx.workspaceRoot, "bun.lock")).then(() => "bun test").catch(() => "npm test"))
        DestructiveCommandGuard.assertCommandSafe(cmd)

        const trimmedCmd = cmd.trim()
        if (!ALLOWED_TEST_RUNNERS.some((re) => re.test(trimmedCmd))) {
          throw new Error(
            `Disallowed test runner: '${trimmedCmd}'. tests_run only permits recognized test frameworks (bun test, npm/pnpm/yarn test, cargo test, pytest, go test, vitest, jest).`,
          )
        }

        const shellBin = process.platform === "win32" ? "cmd.exe" : "sh"
        const shellArgs = [process.platform === "win32" ? "/c" : "-c", trimmedCmd]
        const confined = confineSync(shellBin, shellArgs, {
          mode: "workspace-write",
          workspaceRoot: ctx.workspaceRoot,
        })

        const { stdout, stderr } = await execFileAsync(confined.command, confined.args, {
          cwd: ctx.workspaceRoot,
          env: { ...process.env, ...confined.env },
          maxBuffer: 4 * 1024 * 1024,
        })
        return { content: [{ type: "text", text: `${stdout}\n${stderr}`.trim() }] }
      } catch (err: unknown) {
        const e = err as Error & { stdout?: string; stderr?: string }
        return { content: [{ type: "text", text: `Test run finished with failures:\n${e.message || ""}\n${e.stdout || ""}\n${e.stderr || ""}`.trim() }], isError: true }
      }
    },
  },

  // ── 4. Navi Autonomous Agent Delegation ────────────────────────────────────
  {
    name: "navi_agent_task",
    description: "Delegate an autonomous multi-step coding task to Navi's local AI agent engine",
    parameters: z.object({
      prompt: z.string().describe("Natural language task description for Navi's agent (e.g., 'Refactor database connection pool and run tests')"),
    }),
    execute: async (args, ctx) => {
      try {
        log.info("delegating autonomous task to local Navi runner", { prompt: args.prompt })
        // Invokes navi's headless runner via CLI process for clean sub-agent isolation
        const script = process.argv[1] || ""
        const runArgs = ["run", "--prompt", args.prompt]
        let stdout = ""
        let stderr = ""

        if (script && (script.endsWith(".ts") || script.endsWith(".js"))) {
          try {
            const res = await execFileAsync("bun", ["run", script, ...runArgs], {
              cwd: ctx.workspaceRoot,
              maxBuffer: 8 * 1024 * 1024,
            })
            stdout = res.stdout
            stderr = res.stderr
          } catch {
            const naviBin = process.platform === "win32" ? "navi.cmd" : "navi"
            const res = await execFileAsync(naviBin, runArgs, {
              cwd: ctx.workspaceRoot,
              maxBuffer: 8 * 1024 * 1024,
            })
            stdout = res.stdout
            stderr = res.stderr
          }
        } else {
          const naviBin = process.platform === "win32" ? "navi.cmd" : "navi"
          const res = await execFileAsync(naviBin, runArgs, {
            cwd: ctx.workspaceRoot,
            maxBuffer: 8 * 1024 * 1024,
          })
          stdout = res.stdout
          stderr = res.stderr
        }

        return { content: [{ type: "text", text: stdout || stderr || "Navi autonomous task completed." }] }
      } catch (err: unknown) {
        const e = err as Error
        return { content: [{ type: "text", text: `Navi agent task error: ${e.message || String(err)}` }], isError: true }
      }
    },
  },
]
