import { Global } from "@navi-ai/core/global"
import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Installation } from "../installation"
import { Flag } from "@navi-ai/core/flag/flag"
import { Flock } from "@navi-ai/core/util/flock"
import { Hash } from "@navi-ai/core/util/hash"
import { AppFileSystem } from "@navi-ai/core/filesystem"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { CatalogModelStatus } from "./model-status"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "models-dev" })

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,
  tool_call: Schema.Boolean,
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(CatalogModelStatus),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@navi/ModelsDev") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    // Conditional requests need the raw response (304 is not an error), so the
    // status check happens below instead of through `filterStatusOk`.
    const http = withTransientReadRetry(yield* HttpClient.HttpClient)

    const source = Flag.NAVI_MODELS_URL || "https://models.dev"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    // Validators (ETag / Last-Modified) live beside the payload so the catalog
    // file stays a plain providers map for every other reader.
    const metaPath = `${filepath}.meta.json`
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`

    type Validators = { etag?: string; lastModified?: string; fetchedAt?: number }

    const readValidators: Effect.Effect<Validators> = fs.readJson(metaPath).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
      Effect.map((value) => {
        const meta = value as Validators | undefined
        if (!meta || typeof meta !== "object") return {} as Validators
        return {
          etag: typeof meta.etag === "string" ? meta.etag : undefined,
          lastModified: typeof meta.lastModified === "string" ? meta.lastModified : undefined,
          fetchedAt: typeof meta.fetchedAt === "number" ? meta.fetchedAt : undefined,
        }
      }),
    )

    const writeValidators = (validators: Validators) =>
      fs.writeWithDirs(metaPath, JSON.stringify(validators)).pipe(Effect.catch(() => Effect.void))

    const payloadMtime = Effect.fnUntraced(function* () {
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return undefined
      return Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
    })

    const fresh = Effect.fnUntraced(function* () {
      const mtime = yield* payloadMtime()
      // A 304 does not rewrite the payload, so the last confirmed-fresh time is
      // whichever is newer: the file write or the successful revalidation.
      const fetchedAt = (yield* readValidators).fetchedAt ?? 0
      const at = Math.max(mtime ?? 0, fetchedAt)
      if (!at) return false
      return Date.now() - at < Duration.toMillis(ttl)
    })

    /**
     * Fetch the catalog. Conditional (`If-None-Match` / `If-Modified-Since`) only
     * when the payload it would validate is actually on disk, so a first run still
     * receives a full body. Returns `undefined` on `304 Not Modified`.
     */
    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      const conditional = yield* fs.existsSafe(filepath)
      const validators = conditional ? yield* readValidators : ({} as Validators)
      let request = HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", Installation.USER_AGENT),
      )
      if (validators.etag) request = request.pipe(HttpClientRequest.setHeader("If-None-Match", validators.etag))
      if (validators.lastModified)
        request = request.pipe(HttpClientRequest.setHeader("If-Modified-Since", validators.lastModified))
      const res = yield* http.execute(request).pipe(Effect.timeout("10 seconds"))
      const etag = res.headers["etag"]
      const lastModified = res.headers["last-modified"]

      if (res.status === 304) {
        // Unchanged upstream: keep the catalog bytes, only refresh the
        // freshness clock (the payload's mtime intentionally stays untouched).
        yield* writeValidators({
          etag: etag ?? validators.etag,
          lastModified: lastModified ?? validators.lastModified,
          fetchedAt: Date.now(),
        })
        return undefined
      }
      if (res.status >= 400) {
        return yield* Effect.fail(new Error(`models.dev responded with status ${res.status}`))
      }

      const text = yield* res.text.pipe(Effect.timeout("10 seconds"))
      return { text, etag, lastModified }
    })

    const loadFromDisk = fs.readJson(Flag.NAVI_MODELS_PATH ?? filepath).pipe(
      Effect.catch(() => Effect.succeed(undefined)),
      Effect.map((v) => v as Record<string, Provider> | undefined),
    )

    // Bundled at build time; absent in dev — `tryPromise` covers both.
    // TODO: chunk provider/models-snapshot.js (4.4MB) per-provider so startup only parses what's needed.
    // `NAVI_MODELS_SNAPSHOT_PATH` points at a JSON catalog instead of the
    // bundled module so callers (tests, diagnostics) can pin the fallback.
    const loadSnapshot = Effect.gen(function* () {
      const override = process.env["NAVI_MODELS_SNAPSHOT_PATH"]
      if (override) {
        return yield* fs.readJson(override).pipe(
          Effect.map((v) => v as Record<string, Provider>),
          Effect.orElseSucceed(() => undefined),
        )
      }
      return yield* Effect.tryPromise({
        // @ts-ignore — generated at build time, may not exist in dev
        try: () => import("./models-snapshot.js").then((m) => m.snapshot as Record<string, Provider> | undefined),
        catch: () => undefined,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))
    })

    const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
      const fetched = yield* fetchApi()
      if (!fetched) return undefined
      yield* fs.writeWithDirs(filepath, fetched.text)
      yield* writeValidators({ etag: fetched.etag, lastModified: fetched.lastModified, fetchedAt: Date.now() })
      return fetched.text
    })

    const parse = (text: string) =>
      Effect.try({
        try: () => JSON.parse(text) as Record<string, Provider>,
        catch: (cause) => cause,
      }).pipe(
        Effect.tapError((cause) =>
          Effect.sync(() => log.debug("invalid models.dev JSON, using empty", { error: String(cause) })),
        ),
        Effect.orElseSucceed(() => ({}) as Record<string, Provider>),
      )

    const populate = Effect.gen(function* () {
      const fromDisk = yield* loadFromDisk
      if (fromDisk) return fromDisk
      // The bundled/snapshot catalog is local, so it stays the offline fallback
      // even when fetching is disabled; NAVI_DISABLE_MODELS_FETCH only stops
      // network refreshes.
      const snapshot = yield* loadSnapshot
      if (snapshot) return snapshot
      if (Flag.NAVI_DISABLE_MODELS_FETCH) return {}
      // Flock is cross-process: concurrent navi CLIs can race on this cache file.
      const text = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          return yield* fetchAndWrite()
        }),
      ).pipe(
        // Offline / HTTP failure with no cache at all: degrade instead of dying.
        Effect.tapCause((cause) => Effect.logWarning("models.dev fetch failed, using fallback catalog", { cause })),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (text === undefined) {
        // A concurrent process may have populated the cache while we waited.
        return (yield* loadFromDisk) ?? snapshot ?? {}
      }
      return yield* parse(text)
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

    const get = (): Effect.Effect<Record<string, Provider>> => cachedGet

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (!force && (yield* fresh())) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && (yield* fresh())) return
          const text = yield* fetchAndWrite()
          // 304 leaves the in-memory catalog untouched and valid.
          if (text !== undefined) yield* invalidate
        }),
      ).pipe(
        Effect.tapCause((cause) => Effect.logError("Failed to fetch models.dev", { cause })),
        Effect.ignore,
      )
    })

    if (!Flag.NAVI_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions.
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes")), Effect.ignore))
    }

    return Service.of({ get, refresh })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as ModelsDev from "./models"


