export * as ConfigCommand from "./command"

import * as Log from "@navi-ai/core/util/log"
import { Schema } from "effect"
import { NamedError } from "@navi-ai/core/util/error"
import { Glob } from "@navi-ai/core/util/glob"
import { Bus } from "@/bus"
import { zod } from "@navi-ai/core/effect-zod"
import { withStatics } from "@navi-ai/core/schema"
import { configEntryNameFromPath } from "./entry-name"
import { InvalidError } from "./error"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"

const log = Log.create({ service: "config" })

// Memoized Glob.scan per dir with short TTL (see agent.ts): command config
// reloads share the listing, but newly added files are still picked up.
// Invalidation is TTL-based (no manual clear needed); symlink:false matches
// the original non-memoized scan.
const scanCache = new Map<string, { at: number; files: Promise<string[]> }>()
const SCAN_TTL_MS = 30_000
function cachedScan(dir: string, pattern: string): Promise<string[]> {
  const key = `${dir}\n${pattern}`
  const now = Date.now()
  const hit = scanCache.get(key)
  if (hit && now - hit.at < SCAN_TTL_MS) return hit.files
  const p = Glob.scan(pattern, { cwd: dir, absolute: true, dot: true, symlink: false })
  scanCache.set(key, { at: now, files: p })
  p.catch(() => scanCache.delete(key))
  return p
}

export function invalidateCommandScan(dir?: string, pattern?: string) {
  if (dir === undefined) scanCache.clear()
  else if (pattern === undefined) {
    for (const key of scanCache.keys()) {
      if (key.startsWith(`${dir}\n`)) scanCache.delete(key)
    }
  } else scanCache.delete(`${dir}\n${pattern}`)
}

export const Info = Schema.Struct({
  template: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(ConfigModelID),
  subtask: Schema.optional(Schema.Boolean),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export async function load(dir: string) {
  const result: Record<string, Info> = {}
  for (const item of await cachedScan(dir, "{command,commands}/**/*.md")) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse command ${item}`
      const { Session } = await import("@/session/session")
      void Bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
      log.error("failed to load command", { command: item, err })
      return undefined
    })
    if (!md) continue

    const patterns = ["/.navi/command/", "/.navi/commands/", "/command/", "/commands/"]
    const name = configEntryNameFromPath(item, patterns)

    const config = {
      name,
      ...md.data,
      template: md.content.trim(),
    }
    const parsed = Info.zod.safeParse(config)
    if (parsed.success) {
      result[config.name] = parsed.data
      continue
    }
    throw new InvalidError({ path: item, issues: parsed.error.issues }, { cause: parsed.error })
  }
  return result
}
