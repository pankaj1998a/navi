export * from "./gen/types.gen.js"
import type { SessionGetResponses } from "./gen/types.gen.js"
export type Session = SessionGetResponses[200]

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { NaviClient } from "./gen/sdk.gen.js"
export { type Config as NaviClientConfig, NaviClient }
// Backward compatibility
export { type Config as naviClientConfig, NaviClient as naviClient }

export function createNaviClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    const isNonASCII = /[^\x00-\x7F]/.test(config.directory)
    const encodedDirectory = isNonASCII ? encodeURIComponent(config.directory) : config.directory
    config.headers = {
      ...config.headers,
      "x-navi-directory": encodedDirectory,
    }
  }

  const client = createClient(config)
  return new NaviClient({ client })
}

export const createnaviClient = createNaviClient
