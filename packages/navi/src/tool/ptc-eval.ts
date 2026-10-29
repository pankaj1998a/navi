/**
 * Program-aided Tool Composition (PTC) Engine
 * Ported from DeepSeek Harness (packages/ptc-runtime/ptc-runtime).
 *
 * Allows models to emit async JavaScript programs that orchestrate multiple
 * tool operations locally in a single round-trip, dramatically reducing latency
 * and token consumption.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { spawnSync } from "node:child_process"
const DESCRIPTION = "Executes async JavaScript/TypeScript programs that compose multiple tools in local loops without repetitive LLM round-trips."

import { confineSync, DestructiveCommandGuard, isPathContained, SandboxPathGuard } from "@/sandbox"

const log = Log.create({ service: "tool.ptc-eval" })

export const Parameters = Schema.Struct({
  code: Schema.String.annotate({
    description: "Async JavaScript code to execute. Can use 'await tools.<method>()' and return any JSON serializable result.",
  }),
  timeoutMs: Schema.optional(Schema.Number).annotate({
    description: "Maximum execution budget in milliseconds (default: 30000ms).",
  }),
})

export interface PtcHostBindings {
  read(args: { path: string; offset?: number; limit?: number }): Promise<string>
  glob(args: { pattern: string; cwd?: string }): Promise<string[]>
  grep(args: { pattern: string; path?: string; include?: string }): Promise<Array<{ file: string; line: number; text: string }>>
  write(args: { path: string; content: string }): Promise<string>
  edit(args: { path: string; old_string: string; new_string: string }): Promise<string>
  shell(args: { command: string }): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

function resolveSafePath(baseDir: string, target: string, isWrite = false): string {
  const fullPath = path.isAbsolute(target) ? target : path.resolve(baseDir, target)
  if (!isPathContained(baseDir, fullPath)) {
    throw new Error(`SANDBOX_VIOLATION: Access denied to path outside workspace sandbox (${target})`)
  }
  SandboxPathGuard.assertPathAllowed(fullPath, { mode: "workspace-write", workspaceRoot: baseDir }, isWrite)
  return fullPath
}

function createPtcBindings(baseDir: string): PtcHostBindings {
  return {
    async read({ path: target, offset, limit }) {
      const fullPath = resolveSafePath(baseDir, target, false)
      const raw = await fs.readFile(fullPath, "utf-8")
      const lines = raw.split("\n")
      const start = Math.max(0, (offset ?? 1) - 1)
      const count = limit ?? lines.length
      return lines.slice(start, start + count).join("\n")
    },

    async glob({ pattern, cwd }) {
      const searchDir = cwd ? resolveSafePath(baseDir, cwd, false) : baseDir
      const { Glob } = await import("@navi-ai/core/util/glob")
      const matches = Glob.scanSync(pattern, { cwd: searchDir, absolute: false })
      return matches
    },

    async grep({ pattern, path: targetDir, include }) {
      const searchDir = targetDir ? resolveSafePath(baseDir, targetDir, false) : baseDir
      const regex = new RegExp(pattern, "i")
      const results: Array<{ file: string; line: number; text: string }> = []

      async function walk(dir: string) {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(full)
          } else if (entry.isFile()) {
            if (include && !entry.name.endsWith(include)) continue
            try {
              const content = await fs.readFile(full, "utf-8")
              const lines = content.split("\n")
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i]!)) {
                  results.push({
                    file: path.relative(baseDir, full),
                    line: i + 1,
                    text: lines[i]!.trim(),
                  })
                  if (results.length >= 100) return
                }
              }
            } catch {
              // skip binary or unreadable files
            }
          }
        }
      }

      await walk(searchDir)
      return results
    },

    async write({ path: target, content }) {
      const fullPath = resolveSafePath(baseDir, target, true)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, "utf-8")
      return `Successfully wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${target}`
    },

    async edit({ path: target, old_string, new_string }) {
      const fullPath = resolveSafePath(baseDir, target, true)
      const content = await fs.readFile(fullPath, "utf-8")
      if (!content.includes(old_string)) {
        throw new Error(`old_string not found in ${target}`)
      }
      const updated = content.replace(old_string, new_string)
      await fs.writeFile(fullPath, updated, "utf-8")
      return `Successfully replaced string in ${target}`
    },

    async shell({ command }: { command: string }) {
      DestructiveCommandGuard.assertCommandSafe(command)
      const shellBin = process.platform === "win32" ? "cmd.exe" : "sh"
      const shellArgs = [process.platform === "win32" ? "/c" : "-c", command]
      const confined = confineSync(shellBin, shellArgs, { mode: "workspace-write", workspaceRoot: baseDir })
      const res = spawnSync(confined.command, confined.args, {
        cwd: baseDir,
        env: confined.env,
        encoding: "utf-8",
        timeout: 30000,
      })
      return {
        stdout: (res.stdout || "").trim(),
        stderr: (res.stderr || "").trim(),
        exitCode: res.status ?? 1,
      }
    },
  }
}

export const PtcEvalTool = Tool.define(
  "ptc_eval",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const rootDir = instance.directory
          const timeout = params.timeoutMs ?? 30000

          log.info("Executing PTC program", { timeout })

          const bindings = createPtcBindings(rootDir)

          const outcome = yield* Effect.promise(async () => {
            try {
              // Create async function with 'tools' parameter
              const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
              const runner = new AsyncFunction("tools", "console", `"use strict";\n${params.code}`)

              const customConsole = {
                // Mirrors the logger's arity: args beyond the first are dropped
                // by the writer, same as the previous `...args` spread.
                log: (...args: unknown[]) => log.info("[PTC User Log]", args[0] as Record<string, unknown>),
                error: (...args: unknown[]) => log.error("[PTC User Error]", args[0] as Record<string, unknown>),
                warn: (...args: unknown[]) => log.warn("[PTC User Warn]", args[0] as Record<string, unknown>),
              }

              // Race execution with timeout
              let timer: ReturnType<typeof setTimeout> | undefined
              const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`PTC execution exceeded budget of ${timeout}ms`)), timeout)
              })

              try {
                const executionPromise = runner(bindings, customConsole)
                return await Promise.race([executionPromise, timeoutPromise])
              } finally {
                clearTimeout(timer)
              }
            } catch (err: unknown) {
              return {
                error: err instanceof Error ? err.message : String(err),
                status: "failed",
              }
            }
          })

          const formatted = typeof outcome === "object" ? JSON.stringify(outcome, null, 2) : String(outcome)

          return {
            title: "PTC Tool Composition Complete",
            output: [
              `⚡ **Program-aided Tool Composition (PTC) Executed**`,
              "```json",
              formatted,
              "```",
            ].join("\n"),
            metadata: { outcome } as Record<string, unknown>,
          }
        }),
    }
  }),
)
