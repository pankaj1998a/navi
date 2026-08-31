export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { NaviClient } from "./gen/sdk.gen.js"
import { wrapClientError } from "./error-interceptor.js"
export { type Config as NaviClientConfig, NaviClient }

function pick(value: string | null, fallback?: string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (value === encodeURIComponent(fallback)) return fallback
  return value
}

function rewrite(request: Request, directory?: string) {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const value = pick(request.headers.get("x-navi-directory"), directory)
  if (!value) return request

  const url = new URL(request.url)
  if (!url.searchParams.has("directory")) {
    url.searchParams.set("directory", value)
  }

  const next = new Request(url, request)
  next.headers.delete("x-navi-directory")
  return next
}

/** Default HTTP idle timeout (Bun Request.timeout). Long enough for agent prompts; finite to avoid hung sockets. */
const DEFAULT_HTTP_TIMEOUT_MS = 600_000

export function createNaviClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // Bun: Request.timeout is idle timeout in ms. Browsers ignore this property.
      // Previously set to `false` (no timeout), which could hang forever on stalled connections.
      if (req && typeof req === "object") {
        ;(req as { timeout?: number }).timeout = DEFAULT_HTTP_TIMEOUT_MS
      }
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-navi-directory": encodeURIComponent(config.directory),
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) => rewrite(request, config?.directory))
  client.interceptors.error.use(wrapClientError)
  return new NaviClient({ client })
}
