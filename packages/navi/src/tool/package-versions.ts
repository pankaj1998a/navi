import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import path from "path"
import DESCRIPTION from "./package-versions.txt"

export const ECOSYSTEMS = [
  "npm",
  "pypi",
  "crates",
  "go",
  "rubygems",
  "packagist",
  "nuget",
  "hex",
  "pub",
  "maven",
] as const
export type Ecosystem = (typeof ECOSYSTEMS)[number]

// Human-facing registry page URLs used in the per-package `url` field.
const REGISTRY_PAGE: Record<Ecosystem, (name: string) => string> = {
  npm: (name) => `https://www.npmjs.com/package/${name}`,
  pypi: (name) => `https://pypi.org/project/${name}`,
  crates: (name) => `https://crates.io/crates/${name}`,
  go: (name) => `https://pkg.go.dev/${name}`,
  rubygems: (name) => `https://rubygems.org/gems/${name}`,
  packagist: (name) => `https://packagist.org/packages/${name}`,
  nuget: (name) => `https://www.nuget.org/packages/${name}`,
  hex: (name) => `https://hex.pm/packages/${name}`,
  pub: (name) => `https://pub.dev/packages/${name}`,
  maven: (name) => `https://central.sonatype.com/artifact/${name.replace(":", "/")}`,
}

const REGISTRY_BASE: Record<Ecosystem, string> = {
  npm: "https://registry.npmjs.org",
  pypi: "https://pypi.org/pypi",
  crates: "https://crates.io/api/v1/crates",
  go: "https://proxy.golang.org",
  rubygems: "https://rubygems.org/api/v1/versions",
  packagist: "https://repo.packagist.org/p2",
  nuget: "https://api.nuget.org/v3-flatcontainer",
  hex: "https://hex.pm/api/packages",
  pub: "https://pub.dev/api/packages",
  maven: "https://search.maven.org/solrsearch/select",
}

export const Parameters = Schema.Struct({
  manifestPath: Schema.optional(Schema.String).annotate({
    description:
      "Absolute or project-relative path to a dependency manifest (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, pom.xml, .csproj, Gemfile, composer.json, pubspec.yaml, mix.exs). When given, each dependency in the manifest is checked.",
  }),
  packages: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      'Explicit package list, e.g. ["npm:react", "pypi:requests", "crates:serde"]. "registry:name" is preferred; bare names use the ecosystem param (default npm). Maven packages use "maven:groupId:artifactId".',
  }),
  ecosystem: Schema.Literals(["npm", "pypi", "crates", "go", "rubygems", "packagist", "nuget", "hex", "pub", "maven"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("npm" as const)))
    .annotate({
      description:
        "Default registry for bare package names: npm | pypi | crates | go | rubygems | packagist | nuget | hex | pub | maven. Defaults to npm.",
    }),
  includePrerelease: Schema.optional(Schema.Boolean)
    .pipe(Schema.withDecodingDefault(Effect.succeed(false)))
    .annotate({
      description: "Include pre-release versions when determining the latest version (default false).",
    }),
})

type Parameters = Schema.Schema.Type<typeof Parameters>

export type PackageEntry = { name: string; registry: Ecosystem; wanted?: string }

export type PackageResult = {
  package: string
  registry: string
  wanted: string
  latest: string
  outdated: boolean
  url: string
  advisory?: string
  error?: string
}

const MAX_PACKAGES = 50
const REQUEST_TIMEOUT = 15_000

/** Split a "registry:name" ref, defaulting bare names to the given ecosystem. */
export function parsePackageRef(ref: string, fallback: Ecosystem): PackageEntry {
  const idx = ref.indexOf(":")
  if (idx > -1) {
    const prefix = ref.slice(0, idx).trim().toLowerCase()
    if ((ECOSYSTEMS as readonly string[]).includes(prefix)) {
      return { registry: prefix as Ecosystem, name: ref.slice(idx + 1).trim() }
    }
  }
  return { registry: fallback, name: ref.trim() }
}

/**
 * Compare two version strings (semver-flavoured, tolerant of "v" prefixes).
 * Returns < 0 when a < b, 0 when equal, > 0 when a > b. Pre-release segments
 * sort below the corresponding stable version.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const base = (v.trim().replace(/^v/i, "").split(/[+@]/)[0] ?? "0").split("-")
    const core = base[0] ?? "0"
    return {
      parts: core.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p.replace(/[^\w].*$/, "") || p)),
      pre: (base[1] ?? "").split(".").filter(Boolean),
    }
  }
  const cmpIdent = (x: string | number, y: string | number): number => {
    if (typeof x === "number" && typeof y === "number") return x - y
    const xs = String(x)
    const ys = String(y)
    const xn = Number(xs)
    const yn = Number(ys)
    if (!Number.isNaN(xn) && !Number.isNaN(yn)) return xn - yn
    return xs < ys ? -1 : xs > ys ? 1 : 0
  }
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.parts.length, right.parts.length)
  for (let i = 0; i < len; i++) {
    const c = cmpIdent(left.parts[i] ?? 0, right.parts[i] ?? 0)
    if (c !== 0) return c
  }
  // Equal cores: stable versions sort above pre-release ones.
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i]
    const y = right.pre[i]
    if (!x) return -1
    if (!y) return 1
    const c = cmpIdent(x, y)
    if (c !== 0) return c
  }
  return 0
}

/** True when a version string carries a pre-release or dev channel marker. */
export function isPrereleaseVersion(v: string): boolean {
  const pre = v.trim().replace(/^v/i, "").split("-")[1]
  return Boolean(pre) || /dev|alpha|beta|rc|snapshot|preview/i.test(v)
}

const maxBy = (versions: string[]): string => versions.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b))

/**
 * Extract the latest published version from a registry response body.
 * Throws with a helpful message for empty/unexpected responses so the caller
 * can turn it into a per-entry error.
 */
export function extractLatest(registry: Ecosystem, body: string, includePrerelease: boolean): string {
  const miss = (r: string) => {
    throw new Error(`no version data returned by ${r} (package may not exist)`)
  }
  const pick = (versions: string[], filter: (v: string) => boolean = () => true): string => {
    const usable = versions.filter((v) => Boolean(v) && filter(v))
    if (!usable.length) miss(registry)
    return maxBy(usable)
  }
  switch (registry) {
    case "npm": {
      const data = JSON.parse(body) as { "dist-tags"?: Record<string, string>; versions?: Record<string, unknown> }
      if (includePrerelease && data.versions) return pick(Object.keys(data.versions))
      return data["dist-tags"]?.latest ?? miss(registry)
    }
    case "pypi": {
      const data = JSON.parse(body) as { info?: { version?: string }; releases?: Record<string, unknown> }
      if (includePrerelease && data.releases) return pick(Object.keys(data.releases))
      return data.info?.version ?? miss(registry)
    }
    case "crates": {
      const data = JSON.parse(body) as {
        crate?: { max_stable_version?: string; max_version?: string; newest_version?: string }
      }
      const crate = data.crate
      return (includePrerelease ? crate?.newest_version ?? crate?.max_version : crate?.max_stable_version) ?? miss(registry)
    }
    case "go": {
      if (includePrerelease) {
        return pick(
          body.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("v")),
          (v) => includePrerelease || !isPrereleaseVersion(v),
        )
      }
      const data = JSON.parse(body) as { Version?: string }
      return data.Version ?? miss(registry)
    }
    case "rubygems": {
      const data = JSON.parse(body) as { version?: string } | Array<{ number?: string; prerelease?: boolean }>
      if (Array.isArray(data)) return pick(data.map((r) => r.number ?? "").filter(Boolean), (v) => includePrerelease || !data.find((r) => r.number === v)?.prerelease)
      return data.version ?? miss(registry)
    }
    case "packagist": {
      const data = JSON.parse(body) as { packages?: Record<string, Array<{ version?: string }>> }
      return pick(
        Object.values(data.packages ?? {}).flat().map((r) => r.version ?? ""),
        (v) => includePrerelease || !isPrereleaseVersion(v),
      )
    }
    case "nuget": {
      const data = JSON.parse(body) as { versions?: string[] }
      if (!data.versions?.length) miss(registry)
      return pick(
        data.versions ?? [],
        (v) => includePrerelease || !isPrereleaseVersion(v),
      )
    }
    case "hex": {
      const data = JSON.parse(body) as Array<{ version?: string }>
      return pick(
        (Array.isArray(data) ? data : []).map((r) => r.version ?? ""),
        (v) => includePrerelease || !isPrereleaseVersion(v),
      )
    }
    case "pub": {
      const data = JSON.parse(body) as { latest?: { version?: string }; versions?: Array<{ version?: string }> }
      if (includePrerelease) return pick((data.versions ?? []).map((r) => r.version ?? ""))
      return data.latest?.version ?? miss(registry)
    }
    case "maven": {
      const data = JSON.parse(body) as { response?: { docs?: Array<{ latestVersion?: string }> } }
      return pick((data.response?.docs ?? []).map((r) => r.latestVersion ?? ""))
    }
  }
}

// --- Manifest parsing -------------------------------------------------------

export type ParsedManifest = { ecosystem: Ecosystem; deps: PackageEntry[] }

type ManifestDep = { name: string; wanted?: string }
const attach = (registry: Ecosystem, deps: Array<ManifestDep>): PackageEntry[] =>
  deps.map((dep) => ({ ...dep, registry }))

const parseJsonDeps = (text: string, keys: string[]): Array<ManifestDep> => {
  const data = JSON.parse(text) as Record<string, Record<string, string>>
  return keys.flatMap((key) =>
    Object.entries(data[key] ?? {}).map(([name, wanted]) => ({ name, wanted: wanted || undefined })),
  )
}

const parseRequiresLines = (text: string): Array<ManifestDep> =>
  text.split("\n").flatMap((raw) => {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith("-")) return []
    const name = line.split(/[<>=!~;, \t[]+/)[0]
    if (!name) return []
    const pinned = line.match(/==\s*([^;#\s]+)/)
    return [{ name, wanted: pinned?.[1] ?? undefined }]
  })

const parseTomlSectionDeps = (text: string, sections: string[]): Array<ManifestDep> => {
  let active = false
  let deps: Array<ManifestDep> = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    const section = line.match(/^\[(.+)\]$/)
    if (section) {
      active = (section[1] as string | undefined) !== undefined && sections.includes(section[1] as string)
      continue
    }
    if (!active || !line || line.startsWith("#")) continue
    const quoted = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"/)
    if (quoted) {
      deps = [...deps, { name: quoted[1] ?? "", wanted: quoted[2] || undefined }]
      continue
    }
    const inline = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*\{/)
    if (inline) deps = [...deps, { name: inline[1] ?? "", wanted: line.match(/version\s*=\s*"([^"]*)"/)?.[1] ?? line.match(/\{[^}]*"([^"]*)"/)?.[1] }]
  }
  return deps
}

const parseGoDeps = (text: string): Array<ManifestDep> => {
  let inRequire = false
  return text.split("\n").flatMap((raw) => {
    const line = raw.replace(/\/\/.*$/, "").trim()
    if (/^require\s*\(/.test(line)) {
      inRequire = true
      return []
    }
    if (inRequire && /^\)/.test(line)) {
      inRequire = false
      return []
    }
    const inline = line.match(/^require\s+(\S+)\s+(v\S+)/)
    if (inline) return [{ name: inline[1] ?? "", wanted: (inline[2] ?? "").replace(/^v/, "") }]
    if (!inRequire) return []
    const block = line.match(/^([\w./-]+)\s+(v\S+)/)
    return block ? [{ name: block[1] ?? "", wanted: (block[2] ?? "").replace(/^v/, "") }] : []
  })
}

const parsePubspecDeps = (text: string): Array<ManifestDep> => {
  let active = false
  return text.split("\n").flatMap((raw) => {
    const line = raw.trim()
    if (/^dependencies:|^dev_dependencies:/.test(line)) {
      active = true
      return []
    }
    if (line && !line.startsWith("#") && !line.startsWith(" ")) {
      active = false
      return []
    }
    if (!active || !line || line.startsWith("#")) return []
    const entry = line.match(/^([\w-]+):/)
    const name = entry?.[1]
    if (!name || ["sdk", "flutter"].includes(name)) return []
    const spec = line.split(":").slice(1).join(":").trim()
    return [{ name, wanted: spec && !spec.startsWith("#") ? spec.replace(/^\^/, "") : undefined }]
  })
}

export function parseManifest(fileName: string, text: string): ParsedManifest {
  const file = fileName.toLowerCase().replace(/\\/g, "/")
  if (file.endsWith("package.json")) return { ecosystem: "npm", deps: attach("npm", parseJsonDeps(text, ["dependencies", "devDependencies"])) }
  if (file.endsWith("composer.json")) return { ecosystem: "packagist", deps: attach("packagist", parseJsonDeps(text, ["require", "require-dev"])) }
  if (file.endsWith("requirements.txt")) return { ecosystem: "pypi", deps: attach("pypi", parseRequiresLines(text)) }
  if (file.endsWith("pyproject.toml")) {
    let deps: Array<ManifestDep> = []
    const start = text.indexOf("[project]")
    if (start !== -1) {
      const next = text.indexOf("\n[", start + 1)
      const block = text.slice(start, next === -1 ? text.length : next)
      const list = block.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
      if (list) {
        deps = (list[1]?.match(/"([^"]+)"/g) ?? []).flatMap((q) => {
          const spec = q.slice(1, -1).trim()
          const name = spec.split(/[<>=!~;\s[]+/)[0]
          const version = spec.match(/[<>=!~]+\s*([\d.]+[\w.*]*)/)
          return name ? [{ name, wanted: version?.[1] }] : []
        })
      }
    }
    return { ecosystem: "pypi", deps: [...deps, ...parseTomlSectionDeps(text, ["tool.poetry.dependencies"])].map((d) => ({ ...d, registry: "pypi" as const })) }
  }
  if (file.endsWith("cargo.toml")) {
    return { ecosystem: "crates", deps: attach("crates", parseTomlSectionDeps(text, ["dependencies", "dev-dependencies", "build-dependencies"])) }
  }
  if (file.endsWith("go.mod")) return { ecosystem: "go", deps: attach("go", parseGoDeps(text)) }
  if (file.endsWith("gemfile")) {
    return {
      ecosystem: "rubygems",
      deps: attach(
        "rubygems",
        [...text.matchAll(/gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/g)].map((m) => ({
          name: m[1] ?? "",
          wanted: m[2] || undefined,
        })),
      ),
    }
  }
  if (file.endsWith(".csproj")) {
    return {
      ecosystem: "nuget",
      deps: attach(
        "nuget",
        [...text.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)].map((m) => ({
          name: m[1] ?? "",
          wanted: m[2] || undefined,
        })),
      ),
    }
  }
  if (file.endsWith("pom.xml")) {
    return {
      ecosystem: "maven",
      deps: attach(
        "maven",
        [...text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].flatMap((m) => {
          const block = m[1] ?? ""
          const groupId = block.match(/<groupId>([^<]+)<\/groupId>/)?.[1]
          const artifactId = block.match(/<artifactId>([^<]+)<\/artifactId>/)?.[1]
          const version = block.match(/<version>([^<]+)<\/version>/)?.[1]
          return groupId && artifactId ? [{ name: `${groupId}:${artifactId}`, wanted: version }] : []
        }),
      ),
    }
  }
  if (file.endsWith("pubspec.yaml")) return { ecosystem: "pub", deps: attach("pub", parsePubspecDeps(text)) }
  if (file.endsWith("mix.exs")) {
    return {
      ecosystem: "hex",
      deps: attach(
        "hex",
        [...text.matchAll(/\{:([a-z0-9_]+),\s*"(~>?\s*[^"]*)"/g)].map((m) => ({
          name: m[1] ?? "",
          wanted: (m[2] ?? "").trim() || undefined,
        })),
      ),
    }
  }
  throw new Error(`Unsupported manifest type: ${fileName}`)
}

// --- Query construction -----------------------------------------------------

function buildQueryUrl(registry: Ecosystem, name: string, includePrerelease: boolean): string {
  const enc = encodeURIComponent
  const base = REGISTRY_BASE[registry]
  switch (registry) {
    case "npm":
      return includePrerelease ? `${base}/${enc(name)}` : `${base}/${enc(name)}/latest`
    case "pypi":
      return `${base}/${enc(name)}/json`
    case "crates":
      return `${base}/${enc(name)}`
    case "go":
      return includePrerelease ? `${base}/${enc(name)}/@v/list` : `${base}/${enc(name)}/@latest`
    case "rubygems":
      return includePrerelease ? `${base}/${enc(name)}.json` : `${base}/${enc(name)}/latest.json`
    case "packagist":
      return `${base}/${enc(name)}.json`
    case "nuget":
      return `${base}/${enc(name.toLowerCase())}/index.json`
    case "hex":
      return `${base}/${enc(name)}`
    case "pub":
      return `${base}/${enc(name)}`
    case "maven": {
      const [groupId, ...rest] = name.split(":")
      if (!groupId || rest.length === 0) throw new Error(`maven packages must be "groupId:artifactId", got "${name}"`)
      const query = `g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(rest.join(":"))}`
      return `${base}?q=${query}&core=gav&rows=20&wt=json`
    }
  }
}

/** Evaluate a wanted version against the latest published one. */
function evaluate(name: string, registry: Ecosystem, wanted: string | undefined, latest: string): PackageResult {
  const clean = (wanted ?? "").replace(/^[\^~>=<\s]*v?/i, "").trim()
  const base = clean.match(/^(\d+(?:\.\d+){0,2})/)?.[1]
  const pinned = Boolean(base)
  const outdated = Boolean(pinned && compareVersions(base as string, latest) < 0)
  const majors = outdated ? Math.max(0, Number(latest.split(".")[0]) - Number((base as string).split(".")[0])) : 0
  const advisory =
    outdated && majors >= 1
      ? `${name} ${wanted} is ${majors} major version${majors === 1 ? "" : "s"} behind latest ${latest} — pin the newest major to avoid stale dependencies.`
      : undefined
  return {
    package: name,
    registry,
    wanted: wanted ?? "unpinned",
    latest,
    outdated,
    url: REGISTRY_PAGE[registry](name),
    ...(advisory ? { advisory } : {}),
  }
}

const failed = (entry: PackageEntry, issue: unknown): PackageResult => ({
  package: entry.name,
  registry: entry.registry,
  wanted: entry.wanted ?? "unpinned",
  latest: "unknown",
  outdated: false,
  url: REGISTRY_PAGE[entry.registry](entry.name),
  error: issue instanceof Error ? issue.message : String(issue),
})

export const PackageVersionsTool = Tool.define(
  "package_versions",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)
    const decoder = new TextDecoder()

    const fetchLatest = (entry: PackageEntry, includePrerelease: boolean) =>
      Effect.gen(function* () {
        const url = buildQueryUrl(entry.registry, entry.name, includePrerelease)
        const response = yield* httpOk
          .execute(
            HttpClientRequest.get(url).pipe(
              HttpClientRequest.setHeaders({ Accept: "application/json", "User-Agent": "navi" }),
            ),
          )
          .pipe(
            Effect.timeoutOrElse({
              duration: REQUEST_TIMEOUT,
              orElse: () => Effect.fail(new Error(`registry request timed out after ${REQUEST_TIMEOUT / 1000}s`)),
            }),
          )
        const body = decoder.decode(yield* response.arrayBuffer)
        return yield* Effect.try({
          try: () => extractLatest(entry.registry, body, includePrerelease),
          catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        })
      })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Parameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context

          const entries: PackageEntry[] = []
          if (params.manifestPath) {
            const file = path.isAbsolute(params.manifestPath)
              ? params.manifestPath
              : path.resolve(instance.directory, params.manifestPath)
            const text = yield* Effect.promise(() => Bun.file(file).text())
            entries.push(...parseManifest(path.basename(file), text).deps)
          }
          for (const ref of params.packages ?? []) {
            entries.push(parsePackageRef(ref, params.ecosystem ?? "npm"))
          }
          if (entries.length === 0) throw new Error("Provide a manifestPath or at least one package to check")

          const seen = new Set<string>()
          const unique = entries.filter((e) => {
            const key = `${e.registry}:${e.name}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          const capped = unique.slice(0, MAX_PACKAGES)

          const bases = [...new Set(capped.map((e) => REGISTRY_BASE[e.registry]))]

          yield* ctx.ask({
            permission: "package_versions",
            patterns: bases,
            always: ["*"],
            metadata: {
              manifestPath: params.manifestPath,
              packages: capped.map((e) => `${e.registry}:${e.name}`),
            },
          })

          const { assertSafeExternalUrl } = yield* Effect.promise(() => import("@/util/ssrf"))
          yield* Effect.forEach(
            bases,
            (base) =>
              Effect.promise(() => assertSafeExternalUrl(base)).pipe(
                Effect.catch((error: unknown) => Effect.fail(new Error(`blocked URL ${base}: ${String(error)}`))),
              ),
            { concurrency: "unbounded" },
          )

          const results: Array<PackageResult> = yield* Effect.forEach(
            capped,
            (entry) =>
              fetchLatest(entry, params.includePrerelease ?? false).pipe(
                Effect.map((latest) => evaluate(entry.name, entry.registry, entry.wanted, latest)),
                Effect.catch((issue: unknown) => Effect.succeed(failed(entry, issue))),
              ),
            { concurrency: 10 },
          )

          function statusOf(r: PackageResult): string {
            if (r.error) return `ERROR: ${r.error}`
            if (!r.outdated) return "up to date"
            return r.advisory ? `OUTDATED — ${r.advisory}` : "OUTDATED"
          }

          const columns: Array<(r: PackageResult) => string> = [
            (r) => r.package,
            (r) => r.registry,
            (r) => r.wanted,
            (r) => r.latest,
            (r) => statusOf(r),
          ]
          const header = ["Package", "Registry", "Wanted", "Latest", "Status"]
          const widths = columns.map((column, i) =>
            Math.max(header[i]?.length ?? 0, ...results.map((r) => column(r).length)),
          )
          const row = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ")
          const table = [
            row(header),
            widths.map((w) => "-".repeat(w)).join("  "),
            ...results.map((r) => row([r.package, r.registry, r.wanted, r.latest, statusOf(r)])),
          ]
          const outdatedCount = results.filter((r) => r.outdated).length
          const errorCount = results.filter((r) => r.error).length

          return {
            title: `Checked ${results.length} package${results.length === 1 ? "" : "s"} across ${new Set(results.map((r) => r.registry)).size} registry(ies)`,
            output: [
              `Package version check against live registries (${results.length} package${results.length === 1 ? "" : "s"}${capped.length < unique.length ? `, capped at ${MAX_PACKAGES}` : ""}).`,
              "",
              table.join("\n"),
              "",
              `Summary: ${outdatedCount} outdated, ${errorCount} registry error(s). Registry page URLs are in metadata.packages[].url.`,
            ].join("\n"),
            metadata: { manifestPath: params.manifestPath ?? null, packages: results },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
