export * from "./client.js"
export * from "./server.js"

import { createNaviClient } from "./client.js"
import { createNaviServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createNavi(options?: ServerOptions) {
  const server = await createNaviServer({
    ...options,
  })

  const client = createNaviClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}

