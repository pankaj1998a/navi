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
        if (!url.startsWith("https://")) {
          log.error("skill pull rejected: URL must use secure https:// scheme", { url })
          return []
        }

        const base = url.endsWith("/") ? url : `${url}/`
        const index = new URL("index.json", base).href
        const host = base.slice(0, -1)

        const { assertSafeExternalUrl } = yield* Effect.promise(() => import("@/util/ssrf"))
        const ssrfCheck = yield* Effect.promise(() =>
          assertSafeExternalUrl(index).then(() => true).catch((e) => {
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

        const dirs = yield* Effect.forEach(
          list,
          (skill) =>
            Effect.gen(function* () {
              const root = path.join(cache, skill.name)

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
                    return yield* download(
                      new URL(file, `${host}/${skill.name}/`).href,
                      path.join(root, file),
                      expectedHash,
                    )
                  }),
                { concurrency: fileConcurrency },
              )

              if (downloadResults.some((ok) => !ok)) {
                log.error("aborted skill installation: missing or failed checksum verification", {
                  skill: skill.name,
                })
                return null
              }

              // Neutralize prompt-injection vectors in markdown and text files
              for (const file of safeFiles) {
                const ext = path.extname(file).toLowerCase()
                if (ext === ".md" || ext === ".txt") {
                  const filePath = path.join(root, file)
                  if (yield* fs.exists(filePath).pipe(Effect.orDie)) {
                    const rawText = yield* fs.readFileString(filePath).pipe(Effect.orDie)
                    if (file === "SKILL.md") {
                      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(rawText)
                      if (match && match[1] !== undefined && match[2] !== undefined) {
                        const frontmatter = sanitizeUntrustedText(match[1])
                        const body = match[2]
                        const wrappedBody = wrapUntrustedContent(body, `remote-skill:${skill.name}`)
                        const sanitizedFull = `---\n${frontmatter}\n---\n\n${wrappedBody}`
                        yield* fs.writeWithDirs(filePath, sanitizedFull).pipe(Effect.orDie)
                      } else {
                        const wrapped = wrapUntrustedContent(rawText, `remote-skill:${skill.name}`)
                        yield* fs.writeWithDirs(filePath, wrapped).pipe(Effect.orDie)
                      }
                    } else {
                      const sanitized = sanitizeUntrustedText(rawText)
                      yield* fs.writeWithDirs(filePath, sanitized).pipe(Effect.orDie)
                    }
                  }
                }
              }

              const md = path.join(root, "SKILL.md")
              return (yield* fs.exists(md).pipe(Effect.orDie)) ? root : null
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
