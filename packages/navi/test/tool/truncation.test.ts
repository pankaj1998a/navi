import { describe, test, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer } from "effect"
import { Truncate } from "@/tool/truncate"
import { Config } from "@/config/config"
import { Identifier } from "../../src/id/id"
import { Process } from "@/util/process"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { testEffect } from "../lib/effect"
import { writeFileStringScoped } from "../lib/filesystem"
import { TestConfig } from "../fixture/config"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")
const ROOT = path.resolve(import.meta.dir, "..", "..")

const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, NodeFileSystem.layer))

const configuredLayer = (cfg: Config.Info) =>
  Layer.mergeAll(Truncate.defaultLayer, NodeFileSystem.layer, TestConfig.layer({ get: () => Effect.succeed(cfg) }))
const configuredIt = (cfg: Config.Info) => testEffect(configuredLayer(cfg))

describe("Truncate", () => {
  describe("output", () => {
    it.live("truncates large json file by bytes", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = yield* Effect.promise(() => Filesystem.readText(path.join(FIXTURES_DIR, "models-api.json")))
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("truncated...")
        if (result.truncated) expect(result.outputPath).toBeDefined()
      }),
    )

    it.live("returns content unchanged when under limits", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = "line1\nline2\nline3"
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(false)
        expect(result.content).toBe(content)
      }),
    )

    it.live("truncates by line count", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        const result = yield* svc.output(lines, { maxLines: 10 })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("...90 lines truncated...")
      }),
    )

    it.live("truncates by byte count", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = "a".repeat(1000)
        const result = yield* svc.output(content, { maxBytes: 100 })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("truncated...")
      }),
    )

    it.live("truncates from head by default", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
        const result = yield* svc.output(lines, { maxLines: 3 })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("line0")
        expect(result.content).toContain("line1")
        expect(result.content).toContain("line2")
        expect(result.content).not.toContain("line9")
      }),
    )

    it.live("truncates from tail when direction is tail", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n")
        const result = yield* svc.output(lines, { maxLines: 3, direction: "tail" })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("line7")
        expect(result.content).toContain("line8")
        expect(result.content).toContain("line9")
        expect(result.content).not.toContain("line0")
      }),
    )

    test("uses default MAX_LINES and MAX_BYTES", () => {
      expect(Truncate.MAX_LINES).toBe(2000)
      expect(Truncate.MAX_BYTES).toBe(50 * 1024)
    })

    it.live("limits() falls back to MAX_LINES/MAX_BYTES when Config is not provided", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const resolved = yield* svc.limits()
        expect(resolved.maxLines).toBe(Truncate.MAX_LINES)
        expect(resolved.maxBytes).toBe(Truncate.MAX_BYTES)
      }),
    )

    describe("with tool_output config", () => {
      const limitsIt = configuredIt({ tool_output: { max_lines: 123, max_bytes: 456 } })
      limitsIt.live("limits() reflects config overrides", () =>
        Effect.gen(function* () {
          const resolved = yield* (yield* Truncate.Service).limits()
          expect(resolved.maxLines).toBe(123)
          expect(resolved.maxBytes).toBe(456)
        }),
      )

      // Huge byte budget isolates line truncation. 100 lines against max_lines: 10
      // proves the configured line limit is what `output()` enforces.
      const lineIt = configuredIt({ tool_output: { max_lines: 10, max_bytes: 1024 * 1024 } })
      lineIt.live("output() truncates to configured max_lines", () =>
        Effect.gen(function* () {
          const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
          const result = yield* (yield* Truncate.Service).output(content)
          expect(result.truncated).toBe(true)
          expect(result.content).toContain("...90 lines truncated...")
        }),
      )

      // Huge line budget isolates byte truncation.
      const byteIt = configuredIt({ tool_output: { max_lines: 1_000_000, max_bytes: 100 } })
      byteIt.live("output() truncates to configured max_bytes", () =>
        Effect.gen(function* () {
          const content = "a".repeat(1000)
          const result = yield* (yield* Truncate.Service).output(content)
          expect(result.truncated).toBe(true)
          expect(result.content).toContain("bytes truncated...")
        }),
      )

      const overrideIt = configuredIt({ tool_output: { max_lines: 10, max_bytes: 100 } })
      overrideIt.live("per-call options still override config", () =>
        Effect.gen(function* () {
          const content = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n")
          const result = yield* (yield* Truncate.Service).output(content, {
            maxLines: 1000,
            maxBytes: 1024 * 1024,
          })
          expect(result.truncated).toBe(false)
        }),
      )
    })

    it.live("large single-line file truncates with byte message", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = yield* Effect.promise(() => Filesystem.readText(path.join(FIXTURES_DIR, "models-api.json")))
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("bytes truncated...")
        expect(Buffer.byteLength(content, "utf-8")).toBeGreaterThan(Truncate.MAX_BYTES)
      }),
    )

    it.live("writes full output to file when truncated", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        const result = yield* svc.output(lines, { maxLines: 10 })

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("The tool call succeeded but the output was truncated")
        expect(result.content).toContain("Grep")
        if (!result.truncated) throw new Error("expected truncated")
        expect(result.outputPath).toBeDefined()
        expect(result.outputPath).toContain("tool_")

        const written = yield* Effect.promise(() => Filesystem.readText(result.outputPath!))
        expect(written).toBe(lines)
      }),
    )

    it.live("suggests Task tool when agent has task permission", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        const agent = { permission: [{ permission: "task", pattern: "*", action: "allow" as const }] }
        const result = yield* svc.output(lines, { maxLines: 10 }, agent as any)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("Grep")
        expect(result.content).toContain("Task tool")
      }),
    )

    it.live("omits Task tool hint when agent lacks task permission", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
        const agent = { permission: [{ permission: "task", pattern: "*", action: "deny" as const }] }
        const result = yield* svc.output(lines, { maxLines: 10 }, agent as any)

        expect(result.truncated).toBe(true)
        expect(result.content).toContain("Grep")
        expect(result.content).not.toContain("Task tool")
      }),
    )

    it.live("does not write file when not truncated", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = "short content"
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(false)
        if (result.truncated) throw new Error("expected not truncated")
        expect("outputPath" in result).toBe(false)
      }),
    )

    it.live("keeps the exact head window and marker format", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`)
        const result = yield* svc.output(lines.join("\n"), { maxLines: 10 })

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncated")
        const marker = "\n\n...90 lines truncated...\n\n"
        expect(result.content.startsWith(lines.slice(0, 10).join("\n") + marker)).toBe(true)
        expect(result.content).toContain("The tool call succeeded but the output was truncated. Full output saved to:")
        // Nothing past the window leaks into the preview.
        expect(result.content.slice(0, result.content.indexOf(marker))).not.toContain("line10")
      }),
    )

    it.live("keeps the exact tail window and marker format", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = Array.from({ length: 100 }, (_, i) => `line${i}`)
        const result = yield* svc.output(lines.join("\n"), { maxLines: 10, direction: "tail" })

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncated")
        const marker = "...90 lines truncated...\n\n"
        expect(result.content.startsWith(marker)).toBe(true)
        expect(result.content.endsWith("\n\n" + lines.slice(-10).join("\n"))).toBe(true)
        expect(result.content).not.toContain("line89\n")
      }),
    )

    it.live("byte marker equals the payload size minus the rendered window", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = Array.from({ length: 20_000 }, (_, i) => `${i}:${"x".repeat(60)}`).join("\n")
        const result = yield* svc.output(content)

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncated")
        const match = result.content.match(/^([\s\S]*?)\n\n\.\.\.(\d+) bytes truncated\.\.\./)
        if (!match) throw new Error("missing byte marker")
        const rendered = match[1]!
        const removed = Number(match[2])
        expect(Buffer.byteLength(rendered, "utf-8")).toBeLessThanOrEqual(Truncate.MAX_BYTES)
        expect(removed).toBe(Buffer.byteLength(content, "utf-8") - Buffer.byteLength(rendered, "utf-8"))
      }),
    )

    it.live("writes large multi-byte payloads to disk byte-for-byte", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const line = "日本語テキストと絵文字😀 — ünïcode"
        const content = Array.from({ length: 20_000 }, (_, i) => `${i} ${line}`).join("\n")
        const result = yield* svc.output(content, { direction: "tail" })

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncated")
        const written = yield* Effect.promise(() => Filesystem.readText(result.outputPath))
        expect(written).toBe(content)
        expect(result.content).toContain("bytes truncated...")
        expect(result.content).not.toContain("\uFFFD")
      }),
    )

    it.live("preserves empty lines inside the window", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const lines = ["first", "", "third", "", ...Array.from({ length: 50 }, (_, i) => `tail${i}`)]
        const result = yield* svc.output(lines.join("\n"), { maxLines: 4 })

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncated")
        expect(result.content.startsWith("first\n\nthird\n\n\n...50 lines truncated...")).toBe(true)
      }),
    )

    it.live("single line larger than the byte budget yields an empty window", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const content = "z".repeat(200_000)
        const result = yield* svc.output(content, { maxBytes: 1000 })

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncated")
        expect(result.content.startsWith(`\n\n...${Buffer.byteLength(content)} bytes truncated...`)).toBe(true)
      }),
    )

    test("loads truncate effect in a fresh process", async () => {
      const out = await Process.run([process.execPath, "run", path.join(ROOT, "src", "tool", "truncate.ts")], {
        cwd: ROOT,
      })

      expect(out.code).toBe(0)
    }, 20000)
  })

  describe("cleanup", () => {
    const DAY_MS = 24 * 60 * 60 * 1000

    it.live("deletes files older than 7 days and preserves recent files", () =>
      Effect.gen(function* () {
        const svc = yield* Truncate.Service
        const fs = yield* FileSystem.FileSystem

        yield* fs.makeDirectory(Truncate.DIR, { recursive: true })

        const old = path.join(Truncate.DIR, Identifier.create("tool", "ascending", Date.now() - 10 * DAY_MS))
        const recent = path.join(Truncate.DIR, Identifier.create("tool", "ascending", Date.now() - 3 * DAY_MS))

        yield* writeFileStringScoped(old, "old content")
        yield* writeFileStringScoped(recent, "recent content")
        yield* svc.cleanup()

        expect(yield* fs.exists(old)).toBe(false)
        expect(yield* fs.exists(recent)).toBe(true)
      }),
    )
  })
})
