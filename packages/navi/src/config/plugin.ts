import { Glob } from "@navi-ai/core/util/glob"
import { Schema } from "effect"
import { pathToFileURL } from "url"
import { isPathPluginSpec, parsePluginSpecifier, resolvePathPluginTarget } from "@/plugin/shared"
import { zod } from "@navi-ai/core/effect-zod"
import { withStatics } from "@navi-ai/core/schema"
import path from "path"

export const Options = Schema.Record(Schema.String, Schema.Unknown).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Options = Schema.Schema.Type<typeof Options>

// Spec is the user-config value: either just a plugin identifier, or the identifier plus inline options.
// It answers "what should we load?" but says nothing about where that value came from.
export const Spec = Schema.Union([Schema.String, Schema.mutable(Schema.Tuple([Schema.String, Options]))]).pipe(
  withStatics((s) => ({ zod: zod(s) })),
)
export type Spec = Schema.Schema.Type<typeof Spec>

// Memoized Glob.scan per dir with short TTL (see agent.ts): plugin discovery
// shares the listing within a config reload, but new files are still picked up.
const scanCache = new Map<string, { at: number; files: Promise<string[]> }>()
const SCAN_TTL_MS = 30_000
function cachedScan(dir: string, pattern: string): Promise<string[]> {
  const key = `${dir}\n${pattern}`
  const now = Date.now()
  const hit = scanCache.get(key)
  if (hit && now - hit.at < SCAN_TTL_MS) return hit.files
  const p = Glob.scan(pattern, { cwd: dir, absolute: true, dot: true, symlink: true })
  scanCache.set(key, { at: now, files: p })
  p.catch(() => scanCache.delete(key))
  return p
}

export function invalidatePluginScan(dir?: string) {
  if (!dir) scanCache.clear()
  else for (const key of [...scanCache.keys()]) if (key.startsWith(`${dir}\n`)) scanCache.delete(key)
}

export type Scope = "global" | "local"

// Origin keeps the original config provenance attached to a spec.
// After multiple config files are merged, callers still need to know which file declared the plugin
// and whether it should behave like a global or project-local plugin.
export type Origin = {
  spec: Spec
  source: string
  scope: Scope
}

export async function load(dir: string) {
  const plugins: Spec[] = []

  for (const item of await cachedScan(dir, "{plugin,plugins}/*.{ts,js}")) {
    plugins.push(pathToFileURL(item).href)
  }
  return plugins
}

export function pluginSpecifier(plugin: Spec): string {
  return Array.isArray(plugin) ? plugin[0] : plugin
}

export function pluginOptions(plugin: Spec): Options | undefined {
  return Array.isArray(plugin) ? plugin[1] : undefined
}

// Path-like specs are resolved relative to the config file that declared them so merges later on do not
// accidentally reinterpret `./plugin.ts` relative to some other directory.
export async function resolvePluginSpec(plugin: Spec, configFilepath: string): Promise<Spec> {
  const spec = pluginSpecifier(plugin)
  if (!isPathPluginSpec(spec)) return plugin

  const base = path.dirname(configFilepath)
  const file = (() => {
    if (spec.startsWith("file://")) return spec
    if (path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec)) return pathToFileURL(spec).href
    return pathToFileURL(path.resolve(base, spec)).href
  })()

  const resolved = await resolvePathPluginTarget(file).catch(() => file)

  if (Array.isArray(plugin)) return [resolved, plugin[1]]
  return resolved
}

// Dedupe on the load identity (package name for npm specs, exact file URL for local specs), but keep the
// full Origin so downstream code still knows which config file won and where follow-up writes should go.
export function deduplicatePluginOrigins(plugins: Origin[]): Origin[] {
  const seen = new Set<string>()
  const list: Origin[] = []

  for (const plugin of plugins.toReversed()) {
    const spec = pluginSpecifier(plugin.spec)
    const name = spec.startsWith("file://") ? spec : parsePluginSpecifier(spec).pkg
    if (seen.has(name)) continue
    seen.add(name)
    list.push(plugin)
  }

  return list.toReversed()
}

export * as ConfigPlugin from "./plugin"
