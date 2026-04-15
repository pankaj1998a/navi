import z from "zod"
import { Tool } from "./tool"
import { spawn } from "child_process"
import { Shell } from "@/shell/shell"
import { Instance } from "../project/instance"

/**
 * REPLTool — Interactive REPL for evaluating code and maintaining a persistent context.
 *
 * Unlike BashTool (fire-and-forget), REPLTool maintains state between calls
 * via a persistent Node.js / Bun REPL process per session.
 *
 * Supports:
 *  - JavaScript / TypeScript (via Bun)
 *  - Python (via python3)
 *  - Shell (via bash)
 */

const SESSION_REPLS = new Map<string, { proc: ReturnType<typeof spawn>; buffer: string[] }>()

const REPL_TIMEOUT_MS = 30_000

function getOrCreateRepl(sessionID: string, lang: "js" | "python" | "bash") {
  const key = `${sessionID}:${lang}`
  if (SESSION_REPLS.has(key)) return SESSION_REPLS.get(key)!

  const commands: Record<string, string[]> = {
    js: ["bun", ["repl", "--quiet"] as any],
    python: ["python3", ["-u", "-c", "import code; code.interact(local=locals(), banner='')"] as any],
    bash: ["bash", ["--norc", "--noprofile", "-s"] as any],
  } as unknown as Record<string, string[]>

  const [cmd, args] = [commands[lang][0], commands[lang][1]] as unknown as [string, string[]]

  const proc = spawn(cmd, args, {
    cwd: Instance.directory,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  })

  const entry = { proc, buffer: [] as string[] }
  SESSION_REPLS.set(key, entry)

  proc.stdout?.setEncoding("utf8")
  proc.stderr?.setEncoding("utf8")
  proc.stdout?.on("data", (chunk: string) => entry.buffer.push(chunk))
  proc.stderr?.on("data", (chunk: string) => entry.buffer.push(`[stderr] ${chunk}`))

  proc.once("exit", () => {
    SESSION_REPLS.delete(key)
  })

  return entry
}

export const ReplTool = Tool.define("repl", {
  description: `Evaluate code in a persistent REPL session that maintains state between calls.
Unlike the bash tool, variables and imports from previous calls are available in later calls.

Supported languages:
- **js** (JavaScript/TypeScript via Bun) — best for Node.js code, npm libs
- **python** — Python 3 interpreter with full stdlib
- **bash** — Stateful shell session

Use cases:
- Iteratively explore data structures
- Test code snippets before writing to files
- Chain computations across multiple calls
- Keep expensive objects in memory (DB connections, parsed data)`,

  parameters: z.object({
    code: z.string().describe("Code to evaluate in the REPL"),
    language: z
      .enum(["js", "python", "bash"])
      .default("js")
      .describe("Language / runtime to use"),
    session_id: z
      .string()
      .optional()
      .describe("Optional REPL session identifier to share state across tool calls"),
    reset: z
      .boolean()
      .optional()
      .describe("If true, kill the current REPL session and start fresh"),
  }),

  async execute(params, ctx) {
    const lang = params.language
    const sessionKey = `${ctx.sessionID}:${lang}`

    // Reset session if requested
    if (params.reset && SESSION_REPLS.has(sessionKey)) {
      const old = SESSION_REPLS.get(sessionKey)!
      old.proc.kill()
      SESSION_REPLS.delete(sessionKey)
    }

    const repl = getOrCreateRepl(ctx.sessionID, lang)

    // Clear existing buffer
    repl.buffer.length = 0

    // Send code to stdin
    const codeBlock =
      lang === "js"
        ? `(async () => { ${params.code}; })()\n`
        : lang === "python"
          ? `exec(${JSON.stringify(params.code)})\n`
          : `${params.code}\n`

    repl.proc.stdin?.write(codeBlock)

    // Mark end of output
    const sentinel = `__NAVI_REPL_DONE_${Date.now()}__`
    const echoSentinel =
      lang === "js"
        ? `console.log(${JSON.stringify(sentinel)})\n`
        : lang === "python"
          ? `print(${JSON.stringify(sentinel)})\n`
          : `echo ${sentinel}\n`

    repl.proc.stdin?.write(echoSentinel)

    // Wait for sentinel in output
    const output = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve(repl.buffer.join(""))
        repl.buffer.length = 0
      }, REPL_TIMEOUT_MS)

      const check = setInterval(() => {
        const combined = repl.buffer.join("")
        if (combined.includes(sentinel)) {
          clearTimeout(timeout)
          clearInterval(check)
          const clean = combined.slice(0, combined.indexOf(sentinel)).trim()
          repl.buffer.length = 0
          resolve(clean)
        }
      }, 50)

      ctx.abort.addEventListener("abort", () => {
        clearTimeout(timeout)
        clearInterval(check)
        reject(new Error("REPL execution aborted"))
      })
    })

    return {
      title: `REPL (${lang}): ${params.code.slice(0, 40)}${params.code.length > 40 ? "…" : ""}`,
      metadata: { language: lang, lines: output.split("\n").length },
      output: output || "(no output)",
    }
  },
})
