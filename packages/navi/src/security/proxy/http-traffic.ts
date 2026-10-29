/**
 * HTTP Traffic Interceptor & Replay Engine
 * Captures, inspects, and repeats HTTP traffic for vulnerability testing.
 */

export interface CapturedHttpRequest {
  id: string
  timestamp: string
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  response?: {
    statusCode: number
    statusText: string
    headers: Record<string, string>
    body?: string
    durationMs: number
  }
}

export class HttpTrafficStore {
  private requests: Map<string, CapturedHttpRequest> = new Map()
  private counter = 1

  record(
    req: Omit<CapturedHttpRequest, "id" | "timestamp">,
  ): CapturedHttpRequest {
    const id = String(this.counter++)
    const item: CapturedHttpRequest = {
      ...req,
      id,
      timestamp: new Date().toISOString(),
    }
    this.requests.set(id, item)
    return item
  }

  get(id: string): CapturedHttpRequest | undefined {
    return this.requests.get(id)
  }

  list(filter?: { method?: string; urlPattern?: string; statusCode?: number }): CapturedHttpRequest[] {
    let all = Array.from(this.requests.values())
    if (filter?.method) {
      all = all.filter((r) => r.method.toUpperCase() === filter.method!.toUpperCase())
    }
    if (filter?.urlPattern) {
      const clipped = filter.urlPattern.slice(0, 512)
      let regex: RegExp
      try {
        regex = new RegExp(clipped, "i")
      } catch {
        regex = new RegExp(clipped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      }
      all = all.filter((r) => regex.test(r.url))
    }
    if (filter?.statusCode && filter.statusCode > 0) {
      all = all.filter((r) => r.response?.statusCode === filter.statusCode)
    }
    return all
  }

  async repeat(
    id: string,
    overrides?: {
      method?: string
      url?: string
      headers?: Record<string, string>
      body?: string
    },
  ): Promise<CapturedHttpRequest> {
    const original = this.requests.get(id)
    if (!original) {
      throw new Error(`Request ID ${id} not found in traffic store`)
    }

    const targetUrl = overrides?.url || original.url
    const method = overrides?.method || original.method
    const headers = { ...original.headers, ...(overrides?.headers || {}) }
    const body = overrides?.body !== undefined ? overrides.body : original.body

    const start = Date.now()
    let response: CapturedHttpRequest["response"]

    try {
      const res = await fetch(targetUrl, {
        method,
        headers,
        body: ["GET", "HEAD"].includes(method.toUpperCase()) ? undefined : body,
      })

      const text = await res.text()
      const resHeaders: Record<string, string> = {}
      res.headers.forEach((val, key) => {
        resHeaders[key] = val
      })

      response = {
        statusCode: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: text.slice(0, 50000), // Cap at 50KB in store
        durationMs: Date.now() - start,
      }
    } catch (err) {
      response = {
        statusCode: 0,
        statusText: `Network Error: ${String(err)}`,
        headers: {},
        body: "",
        durationMs: Date.now() - start,
      }
    }

    return this.record({
      method,
      url: targetUrl,
      headers,
      body,
      response,
    })
  }

  async sendNew(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<CapturedHttpRequest> {
    const start = Date.now()
    let response: CapturedHttpRequest["response"]

    try {
      const res = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body: ["GET", "HEAD"].includes(method.toUpperCase()) ? undefined : body,
      })

      const text = await res.text()
      const resHeaders: Record<string, string> = {}
      res.headers.forEach((val, key) => {
        resHeaders[key] = val
      })

      response = {
        statusCode: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: text.slice(0, 50000),
        durationMs: Date.now() - start,
      }
    } catch (err) {
      response = {
        statusCode: 0,
        statusText: `Network Error: ${String(err)}`,
        headers: {},
        body: "",
        durationMs: Date.now() - start,
      }
    }

    return this.record({
      method: method.toUpperCase(),
      url,
      headers,
      body,
      response,
    })
  }
}

export const globalHttpTraffic = new HttpTrafficStore()
