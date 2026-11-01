import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Path, Schema, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { AppFileSystem } from "@navi-ai/core/filesystem"
import { Global } from "@navi-ai/core/global"
import * as Log from "@navi-ai/core/util/log"

const skillConcurrency = 4
const fileConcurrency = 8

class IndexSkill extends Schema.Class<IndexSkill>("IndexSkill")({
  name: Schema.String,
  files: Schema.Array(Schema.String),
  checksums: Schema.Record(Schema.String, Schema.String),
}) {}

class Index extends Schema.Class<Index>("Index")({
  skills: Schema.Array(IndexSkill),
}) {}

export interface Interface {
  readonly pull: (url: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@navi/SkillDiscovery") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Path.Path | HttpClient.HttpClient> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const log = Log.create({ service: "skill-discovery" })
      const fs = yield* AppFileSystem.Service
      const path = yield* Path.Path
      const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
      const cache = path.join(Global.Path.cache, "skills")

      const download = Effect.fn("Discovery.download")(function* (url: string, dest: string, expectedHash?: string) {
        return yield* HttpClientRequest.get(url).pipe(
          http.execute,
          Effect.flatMap((res) => res.arrayBuffer),
          Effect.flatMap((body) =>
            Effect.gen(function* () {
              const uint8 = new Uint8Array(body)
              if (expectedHash) {
                const digest = yield* Effect.promise(async () => {
                  const hashBuf = await crypto.subtle.digest("SHA-256", uint8)
                  return Array.from(new Uint8Array(hashBuf))
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("")
                })
                if (digest.toLowerCase() !== expectedHash.toLowerCase()) {
                  log.error("checksum mismatch for skill file", { url, expectedHash, actualHash: digest })
                  return false
                }
              }
              yield* fs.writeWithDirs(dest, uint8)
              return true
            }),
          ),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.error("failed to download", { url, err })
              return false
            }),
          ),
        )
      })

      const ALLOWED_SKILL_EXTENSIONS = new Set([
        ".md",
        ".txt",
        ".json",
        ".yaml",
        ".yml",
        ".png",
        ".jpg",
        ".jpeg",
        ".svg",
      ])
      const SAFE_SKILL_NAME_RE = /^[a-zA-Z0-9_-]+$/

      const pull = Effect.fn("Discovery.pull")(function* (url: string) {
        // Loopback http:// is a local-development convenience: it stays blocked
        // unless the operator opts in. Every remote host must use https://.
        const allowInsecure = process.env["NAVI_SKILLS_ALLOW_INSECURE"] === "1"
        const parsed = URL.canParse(url) ? new URL(url) : undefined
        if (!parsed) {
          log.error("skill pull rejected: invalid url", { url })
          return []
        }
        const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "")
        const loopback =
          hostname === "localhost" ||
          hostname === "127.0.0.1" ||
          hostname === "::1" ||
          hostname.endsWith(".localhost")
        if (parsed.protocol !== "https:" && !(allowInsecure && loopback)) {
          log.error("skill pull rejected: URL must use secure https:// scheme", { url })
          return []
        }

        const base = url.endsWith("/") ? url : `${url}/`
        const index = new URL("index.json", base).href
        const host = base.slice(0, -1)

        const { assertSafeExternalUrl } = yield* Effect.promise(() => import("@/util/ssrf"))
        const ssrfCheck = yield* Effect.promise(() =>
          assertSafeExternalUrl(index, { allowLocalhost: allowInsecure && loopback })
            .then(() => true)
            .catch((e) => {
              log.error("skill pull SSRF check failed", { url: index, error: String(e) })
              return false
            }),
        )
        if (!ssrfCheck) return []

        log.info("fetching index", { url: index })

        const data = yield* HttpClientRequest.get(index).pipe(
          HttpClientRequest.acceptJson,
          http.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Index)),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.error("failed to fetch index", { url: index, err })
              return null
            }),
          ),
        )

        if (!data) return []

        const { isPathContained } = yield* Effect.promise(() => import("@/sandbox"))
        const { sanitizeUntrustedText, wrapUntrustedContent } = yield* Effect.promise(
          () => import("@/util/untrusted-content"),
        )

        const list = data.skills.filter((skill) => {
          if (!SAFE_SKILL_NAME_RE.test(skill.name)) {
            log.warn("rejected unsafe skill name with special characters or path traversal", { name: skill.name })
            return false
          }
          if (!skill.files.includes("SKILL.md")) {
            log.warn("skill entry missing SKILL.md", { url: index, skill: skill.name })
            return false
          }
          return true
        })

        // Neutralize prompt-injection vectors in markdown and text files. Only
        // applied to freshly downloaded bytes: re-running it on a cached file
        // would wrap an already wrapped body again.
        const sanitizeInPlace = Effect.fnUntraced(function* (file: string, root: string, name: string) {
          const ext = path.extname(file).toLowerCase()
          if (ext !== ".md" && ext !== ".txt") return
          const filePath = path.join(root, file)
          if (!(yield* fs.exists(filePath).pipe(Effect.orDie))) return
          const rawText = yield* fs.readFileString(filePath).pipe(Effect.orDie)
          if (file !== "SKILL.md") {
            yield* fs.writeWithDirs(filePath, sanitizeUntrustedText(rawText)).pipe(Effect.orDie)
            return
          }
          const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(rawText)
          const frontmatter = match?.[1]
          const body = match?.[2]
          if (frontmatter === undefined || body === undefined) {
            yield* fs.writeWithDirs(filePath, wrapUntrustedContent(rawText, `remote-skill:${name}`)).pipe(Effect.orDie)
            return
          }
          yield* fs
            .writeWithDirs(
              filePath,
              `---\n${sanitizeUntrustedText(frontmatter)}\n---\n\n${wrapUntrustedContent(body, `remote-skill:${name}`)}`,
            )
            .pipe(Effect.orDie)
        })

        const dirs = yield* Effect.forEach(
          list,
          (skill) =>
            Effect.gen(function* () {
              const root = path.join(cache, skill.name)
              // Written after a file is downloaded and verified. Checksums alone
              // cannot identify a cached file because sanitizing rewrites it, and
              // an unverified on-disk cache entry is never trusted.
              const manifestPath = path.join(cache, ".verified", `${skill.name}.json`)
              const verified: Record<string, string | undefined> = (yield* fs.exists(manifestPath).pipe(Effect.orDie))
                ? ((yield* fs
                    .readJson(manifestPath)
                    .pipe(Effect.orElseSucceed(() => ({})))) as Record<string, string | undefined>)
                : {}

              // Filter only allowed file extensions and prevent path traversal
              const safeFiles = skill.files.filter((file) => {
                const ext = path.extname(file).toLowerCase()
                if (!ALLOWED_SKILL_EXTENSIONS.has(ext)) {
                  log.warn("rejected untrusted file extension in skill package", { skill: skill.name, file, ext })
                  return false
                }
                const resolvedFile = path.resolve(root, file)
                if (!isPathContained(root, resolvedFile)) {
                  log.warn("rejected directory traversal file path in skill package", { skill: skill.name, file })
                  return false
                }
                return true
              })

              const downloadResults = yield* Effect.forEach(
                safeFiles,
                (file) =>
                  Effect.gen(function* () {
                    const expectedHash = skill.checksums[file]
                    if (!expectedHash) {
                      log.error("missing checksum for skill file in index", { skill: skill.name, file })
                      return false
                    }
                    const dest = path.join(root, file)
                    // Only files this process verified under the same hash are
                    // reusable; anything else is refetched and re-verified.
                    if (
                      verified[file]?.toLowerCase() === expectedHash.toLowerCase() &&
                      (yield* fs.exists(dest).pipe(Effect.orDie))
                    ) {
                      return true
                    }
                    if (!(yield* download(new URL(file, `${host}/${skill.name}/`).href, dest, expectedHash))) return false
                    yield* sanitizeInPlace(file, root, skill.name)
                    return true
                  }),
                { concurrency: fileConcurrency },
              )

              if (downloadResults.some((ok) => !ok)) {
                log.error("aborted skill installation: missing or failed checksum verification", {
                  skill: skill.name,
                })
                return null
              }

              const md = path.join(root, "SKILL.md")
              if (!(yield* fs.exists(md).pipe(Effect.orDie))) return null
              yield* fs
                .writeWithDirs(
                  manifestPath,
                  JSON.stringify(
                    Object.fromEntries(safeFiles.map((file) => [file, skill.checksums[file]])),
                  ),
                )
                .pipe(Effect.orDie)
              return root
            }),
          { concurrency: skillConcurrency },
        )

        return dirs.filter((dir): dir is string => dir !== null)
      })

      return Service.of({ pull: (url: string) => pull(url).pipe(Effect.orDie) })
    }),
  )

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
)

export * as Discovery from "./discovery"
