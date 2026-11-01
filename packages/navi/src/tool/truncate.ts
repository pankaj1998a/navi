import { NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, Layer, Option, Schedule, Context } from "effect"
import path from "path"
import type { Agent } from "../agent/agent"
import { AppFileSystem } from "@navi-ai/core/filesystem"
import { evaluate } from "@/permission/evaluate"
import { Config } from "@/config/config"
import { Identifier } from "../id/id"
import * as Log from "@navi-ai/core/util/log"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"

const log = Log.create({ service: "truncation" })
const RETENTION = Duration.days(7)

export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024
export const DIR = TRUNCATION_DIR
export const GLOB = path.join(TRUNCATION_DIR, "*")

export type Result = { content: string; truncated: false } | { content: string; truncated: true; outputPath: string }

export interface Options {
  maxLines?: number
  maxBytes?: number
  direction?: "head" | "tail"
}

function hasTaskTool(agent?: Agent.Info) {
  if (!agent?.permission) return false
  return evaluate("task", "*", agent.permission).action !== "deny"
}

/** Number of `\n` bytes in `[start, end)`. Native `indexOf` — no JS per-byte loop. */
function countNewlines(buf: Uint8Array, start = 0, end = buf.length) {
  let count = 0
  let at = buf.indexOf(0x0a, start)
  while (at !== -1 && at < end) {
    count++
    at = buf.indexOf(0x0a, at + 1)
  }
  return count
}

const COUNT_CHUNK_BYTES = 4 * 1024 * 1024

/** Same count, but yields to the event loop between 4MB chunks. */
async function countNewlinesAsync(buf: Uint8Array) {
  if (buf.length <= COUNT_CHUNK_BYTES) return countNewlines(buf)
  let count = 0
  for (let base = 0; base < buf.length; base += COUNT_CHUNK_BYTES) {
    const end = Math.min(buf.length, base + COUNT_CHUNK_BYTES)
    count += countNewlines(buf, base, end)
    await new Promise((resolve) => setImmediate(resolve))
  }
  return count
}

type Window = {
  /** Lines to render, in document order. */
  lines: string[]
  /** Bytes consumed by `lines` including the separators that used to join them. */
  bytes: number
  /** True when the byte budget — not the line budget — stopped the window. */
  hitBytes: boolean
}

/**
 * Collect at most `maxLines` / `maxBytes` of lines from one end of the buffer.
 *
 * Works on the encoded bytes so a single `Buffer.from` covers byte counting and
 * the spill write, and so the window stops as soon as a budget is hit instead of
 * walking the whole payload.
 */
function window(buf: Uint8Array, direction: "head" | "tail", maxLines: number, maxBytes: number): Window {
  const out: string[] = []
  let bytes = 0
  let hitBytes = false
  const decoder = new TextDecoder()

  if (direction === "head") {
    let start = 0
    while (start < buf.length && out.length < maxLines) {
      const nl = buf.indexOf(0x0a, start)
      const end = nl === -1 ? buf.length : nl
      const size = end - start + (out.length > 0 ? 1 : 0)
      if (bytes + size > maxBytes) {
        hitBytes = true
        break
      }
      out.push(decoder.decode(buf.subarray(start, end)))
      bytes += size
      if (nl === -1) break
      start = nl + 1
    }
    return { lines: out, bytes, hitBytes }
  }

  let end = buf.length
  while (end > 0 && out.length < maxLines) {
    const prev = buf.lastIndexOf(0x0a, end - 1)
    const start = prev === -1 ? 0 : prev + 1
    const size = end - start + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      hitBytes = true
      break
    }
    out.push(decoder.decode(buf.subarray(start, end)))
    bytes += size
    if (prev === -1) break
    end = prev
  }
  out.reverse()
  return { lines: out, bytes, hitBytes }
}

export interface Interface {
  readonly cleanup: () => Effect.Effect<void>
  readonly write: (text: string | Uint8Array) => Effect.Effect<string>
  /**
   * Returns output unchanged when it fits within the limits, otherwise writes the full text
   * to the truncation directory and returns a preview plus a hint to inspect the saved file.
   */
  readonly output: (text: string, options?: Options, agent?: Agent.Info) => Effect.Effect<Result>
  /**
   * Resolved truncation limits: values from `tool_output` in navi config, or MAX_LINES / MAX_BYTES if unset.
   */
  readonly limits: () => Effect.Effect<{ maxLines: number; maxBytes: number }>
}

export class Service extends Context.Service<Service, Interface>()("@navi/Truncate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const cleanup = Effect.fn("Truncate.cleanup")(function* () {
      const cutoff = Identifier.timestamp(
        Identifier.create("tool", "ascending", Date.now() - Duration.toMillis(RETENTION)),
      )
      const entries = yield* fs.readDirectory(TRUNCATION_DIR).pipe(
        Effect.map((all) => all.filter((name) => name.startsWith("tool_"))),
        Effect.catch(() => Effect.succeed([])),
      )
      for (const entry of entries) {
        if (Identifier.timestamp(entry) >= cutoff) continue
        yield* fs.remove(path.join(TRUNCATION_DIR, entry)).pipe(Effect.catch(() => Effect.void))
      }
    })

    const write = Effect.fn("Truncate.write")(function* (text: string | Uint8Array) {
      const file = path.join(TRUNCATION_DIR, ToolID.ascending())
      yield* fs.ensureDir(TRUNCATION_DIR).pipe(Effect.orDie)
      // Bytes go straight to disk: no second UTF-8 encoding of a possibly
      // 100MB+ string, and the write itself is async (never blocks the loop).
      yield* (typeof text === "string" ? fs.writeFileString(file, text) : fs.writeFile(file, text)).pipe(Effect.orDie)
      return file
    })

    const limits = Effect.fn("Truncate.limits")(function* () {
      const configSvc = yield* Effect.serviceOption(Config.Service)
      if (Option.isNone(configSvc)) return { maxLines: MAX_LINES, maxBytes: MAX_BYTES }
      const cfg = yield* configSvc.value.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
      return {
        maxLines: cfg?.tool_output?.max_lines ?? MAX_LINES,
        maxBytes: cfg?.tool_output?.max_bytes ?? MAX_BYTES,
      }
    })

    const output = Effect.fn("Truncate.output")(function* (text: string, options: Options = {}, agent?: Agent.Info) {
      const resolved = yield* limits()
      const maxLines = options.maxLines ?? resolved.maxLines
      const maxBytes = options.maxBytes ?? resolved.maxBytes
      const direction = options.direction ?? "head"

      // One encode covers the exact byte count, the window scan and the spill
      // write. `text.length` is a cheap lower bound on the UTF-8 byte length, so
      // payloads that cannot possibly fit skip the encode entirely.
      const buf = text.length > maxBytes ? undefined : Buffer.from(text, "utf-8")
      if (buf && buf.length <= maxBytes && 1 + countNewlines(buf) <= maxLines) {
        return { content: text, truncated: false } as const
      }

      const full = buf ?? Buffer.from(text, "utf-8")
      const totalBytes = full.length
      const preview = window(full, direction, maxLines, maxBytes)

      // Byte-truncated output never needs the total line count: the marker is in
      // bytes. Only line-truncated payloads pay for a full newline count.
      const totalLines = preview.hitBytes
        ? 0
        : 1 +
          (full.length > COUNT_CHUNK_BYTES
            ? yield* Effect.promise(() => countNewlinesAsync(full))
            : countNewlines(full))
      const removed = preview.hitBytes ? totalBytes - preview.bytes : totalLines - preview.lines.length
      const unit = preview.hitBytes ? "bytes" : "lines"
      const rendered = preview.lines.join("\n")
      const file = yield* write(full)

      const hint = hasTaskTool(agent)
        ? `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse the Task tool to have explore agent process this file with Grep and Read (with offset/limit). Do NOT read the full file yourself - delegate to save context.`
        : `The tool call succeeded but the output was truncated. Full output saved to: ${file}\nUse Grep to search the full content or Read with offset/limit to view specific sections.`

      return {
        content:
          direction === "head"
            ? `${rendered}\n\n...${removed} ${unit} truncated...\n\n${hint}`
            : `...${removed} ${unit} truncated...\n\n${hint}\n\n${rendered}`,
        truncated: true,
        outputPath: file,
      } as const
    })

    yield* cleanup().pipe(
      Effect.catchCause((cause) => {
        log.error("truncation cleanup failed", { cause: Cause.pretty(cause) })
        return Effect.void
      }),
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.delay(Duration.minutes(1)),
      Effect.forkScoped,
    )

    return Service.of({ cleanup, write, output, limits })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer), Layer.provide(NodePath.layer))

export * as Truncate from "./truncate"
