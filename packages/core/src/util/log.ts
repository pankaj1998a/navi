export * as Log from "./log"

import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import * as Global from "../global"
import z from "zod"
import { Glob } from "./glob"

export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
export type Level = z.infer<typeof Level>

const levelPriority: Record<Level, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}
const keep = 10

let level: Level = "INFO"

function shouldLog(input: Level): boolean {
  return levelPriority[input] >= levelPriority[level]
}

export type Logger = {
  debug(message?: any, extra?: Record<string, any>): void
  info(message?: any, extra?: Record<string, any>): void
  error(message?: any, extra?: Record<string, any>): void
  warn(message?: any, extra?: Record<string, any>): void
  tag(key: string, value: string): Logger
  clone(): Logger
  time(
    message: string,
    extra?: Record<string, any>,
  ): {
    stop(): void
    [Symbol.dispose](): void
  }
}

const loggers = new Map<string, Logger>()

export const Default = create({ service: "default" })

export interface Options {
  print: boolean
  dev?: boolean
  level?: Level
}

let logpath = ""
export function file() {
  return logpath
}
let write = (msg: any) => {
  process.stderr.write(msg)
  return msg.length
}

export async function init(options: Options) {
  if (options.level) level = options.level
  void cleanup(Global.Path.log)
  if (options.print) return
  logpath = path.join(
    Global.Path.log,
    options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
  )
  await fs.truncate(logpath).catch(() => {})
  const stream = createWriteStream(logpath, { flags: "a" })
  write = async (msg: any) => {
    return new Promise((resolve, reject) => {
      stream.write(msg, (err) => {
        if (err) reject(err)
        else resolve(msg.length)
      })
    })
  }
}

async function cleanup(dir: string) {
  const files = (
    await Glob.scan("????-??-??T??????.log", {
      cwd: dir,
      absolute: false,
      include: "file",
    }).catch(() => [])
  )
    .filter((file) => path.basename(file) === file)
    .sort()
  if (files.length <= keep) return

  const doomed = files.slice(0, -keep)
  await Promise.all(doomed.map((file) => fs.unlink(path.join(dir, file)).catch(() => {})))
}

function formatError(error: Error, depth = 0): string {
  const result = error.message
  return error.cause instanceof Error && depth < 10
    ? result + " Caused by: " + formatError(error.cause, depth + 1)
    : result
}

const SECRET_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  { pattern: /\bsk-ant-api\d{2}-[a-zA-Z0-9_-]{32,}\b/g, replacement: "[REDACTED ANTHROPIC KEY]" },
  {
    pattern: /\bsk-(?:proj-|admin-|[a-zA-Z0-9]{20,})[a-zA-Z0-9_-]{12,}\b/g,
    replacement: "[REDACTED OPENAI KEY]",
  },
  { pattern: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, replacement: "[REDACTED AWS ACCESS KEY]" },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{36,82}\b/g,
    replacement: "[REDACTED GITHUB TOKEN]",
  },
  { pattern: /\bBearer\s+[a-zA-Z0-9_\-.]{30,}\b/gi, replacement: "Bearer [REDACTED TOKEN]" },
]

function scrubString(input: string): string {
  let out = input
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(out)) {
      pattern.lastIndex = 0
      out = out.replace(pattern, replacement)
    }
    pattern.lastIndex = 0
  }
  // Generic secret assignment last, handled separately to preserve key
  const generic = /(?:api[_-]?key|secret|access[_-]?token|password|auth[_-]?token)\s*[:=]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi
  out = out.replace(generic, (m) => {
    const key = m.split(/[:=]/)[0]
    return `${key}: "[REDACTED SECRET]"`
  })
  return out
}

let last = Date.now()
export function create(tags?: Record<string, any>) {
  tags = tags || {}

  const service = tags["service"]
  if (service && typeof service === "string") {
    const cached = loggers.get(service)
    if (cached) {
      return cached
    }
  }

  function build(message: any, extra?: Record<string, any>) {
    const prefix = Object.entries({
      ...tags,
      ...extra,
    })
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => {
        const p = `${key}=`
        if (value instanceof Error) return p + scrubString(formatError(value))
        if (typeof value === "object") return p + scrubString(JSON.stringify(value))
        if (typeof value === "string") return p + scrubString(value)
        return p + scrubString(String(value))
      })
      .join(" ")
    const next = new Date()
    const diff = next.getTime() - last
    last = next.getTime()
    const scrubbedMessage =
      typeof message === "string"
        ? scrubString(message)
        : message != null
          ? scrubString(String(message))
          : message
    return [next.toISOString().split(".")[0], "+" + diff + "ms", prefix, scrubbedMessage].filter(Boolean).join(" ") + "\n"
  }
  const result: Logger = {
    debug(message?: any, extra?: Record<string, any>) {
      if (shouldLog("DEBUG")) {
        write("DEBUG " + build(message, extra))
      }
    },
    info(message?: any, extra?: Record<string, any>) {
      if (shouldLog("INFO")) {
        write("INFO  " + build(message, extra))
      }
    },
    error(message?: any, extra?: Record<string, any>) {
      if (shouldLog("ERROR")) {
        write("ERROR " + build(message, extra))
      }
    },
    warn(message?: any, extra?: Record<string, any>) {
      if (shouldLog("WARN")) {
        write("WARN  " + build(message, extra))
      }
    },
    tag(key: string, value: string) {
      if (tags) tags[key] = value
      return result
    },
    clone() {
      return create({ ...tags })
    },
    time(message: string, extra?: Record<string, any>) {
      const now = Date.now()
      result.info(message, { status: "started", ...extra })
      function stop() {
        result.info(message, {
          status: "completed",
          duration: Date.now() - now,
          ...extra,
        })
      }
      return {
        stop,
        [Symbol.dispose]() {
          stop()
        },
      }
    },
  }

  if (service && typeof service === "string") {
    loggers.set(service, result)
  }

  return result
}
