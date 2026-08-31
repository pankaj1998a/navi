export * from "./client.js"
export * from "./server.js"
import type { Model as GenModel, Provider as GenProvider } from "../gen/types.gen.js"

export interface Model extends Omit<GenModel, "capabilities" | "limit" | "cost"> {
  family?: string
  release_date?: string
  capabilities: GenModel["capabilities"] & {
    interleaved?:
      | boolean
      | {
          field: "reasoning_content" | "reasoning_details"
        }
  }
  limit: GenModel["limit"] & {
    input?: number
  }
  cost: GenModel["cost"] & {
    reasoning?: number
    experimentalOver200K?: GenModel["cost"]["experimentalOver200K"] & {
      reasoning?: number
    }
  }
  variants?: Record<string, Record<string, any>>
}

export interface Provider extends Omit<GenProvider, "models"> {
  models: {
    [key: string]: Model
  }
}

import { createNaviClient } from "./client.js"
import { createNaviServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

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
