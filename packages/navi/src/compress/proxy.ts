/**
 * Headroom AI Drop-In Context Optimization Proxy Server
 * Drop-in transparent proxy for OpenAI (/v1/chat/completions) and Anthropic (/v1/messages).
 * Intercepts, detects, and compresses oversized tool outputs and chat context before reaching LLMs.
 */

import { compressAuto, getHeadroomTelemetry } from "./headroom"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "headroom.proxy" })

export interface ProxyOptions {
  port?: number
  hostname?: string
  upstream?: string
  minChars?: number
}

/**
 * Optimizes an OpenAI-format chat payload by compressing tool outputs and bulky context.
 */
export function compressOpenAiPayload(
  payload: any,
  minChars = 600,
): { payload: any; tokensSaved: number } {
  if (!payload || !Array.isArray(payload.messages)) {
    return { payload, tokensSaved: 0 }
  }

  let totalSaved = 0
  const clone = { ...payload }
  clone.messages = payload.messages.map((msg: any) => {
    if (!msg) return msg

    // Compress tool messages or bulky assistant/user context
    if (typeof msg.content === "string" && msg.content.length >= minChars) {
      const outcome = compressAuto(msg.content, minChars)
      if (outcome.tokens_saved_est > 0) {
        totalSaved += outcome.tokens_saved_est
        return {
          ...msg,
          content: outcome.compressed,
        }
      }
    } else if (Array.isArray(msg.content)) {
      const newParts = msg.content.map((part: any) => {
        if (part?.type === "text" && typeof part.text === "string" && part.text.length >= minChars) {
          const outcome = compressAuto(part.text, minChars)
          if (outcome.tokens_saved_est > 0) {
            totalSaved += outcome.tokens_saved_est
            return { ...part, text: outcome.compressed }
          }
        }
        return part
      })
      return { ...msg, content: newParts }
    }

    return msg
  })

  return { payload: clone, tokensSaved: totalSaved }
}

/**
 * Optimizes an Anthropic-format payload by compressing tool_result blocks and conversation history.
 */
export function compressAnthropicPayload(
  payload: any,
  minChars = 600,
): { payload: any; tokensSaved: number } {
  if (!payload || !Array.isArray(payload.messages)) {
    return { payload, tokensSaved: 0 }
  }

  let totalSaved = 0
  const clone = { ...payload }

  clone.messages = payload.messages.map((msg: any) => {
    if (!msg) return msg

    if (typeof msg.content === "string" && msg.content.length >= minChars) {
      const outcome = compressAuto(msg.content, minChars)
      if (outcome.tokens_saved_est > 0) {
        totalSaved += outcome.tokens_saved_est
        return { ...msg, content: outcome.compressed }
      }
    } else if (Array.isArray(msg.content)) {
      const newBlocks = msg.content.map((block: any) => {
        if (block?.type === "tool_result") {
          if (typeof block.content === "string" && block.content.length >= minChars) {
            const outcome = compressAuto(block.content, minChars)
            if (outcome.tokens_saved_est > 0) {
              totalSaved += outcome.tokens_saved_est
              return { ...block, content: outcome.compressed }
            }
          }
        } else if (block?.type === "text" && typeof block.text === "string" && block.text.length >= minChars) {
          const outcome = compressAuto(block.text, minChars)
          if (outcome.tokens_saved_est > 0) {
            totalSaved += outcome.tokens_saved_est
            return { ...block, text: outcome.compressed }
          }
        }
        return block
      })
      return { ...msg, content: newBlocks }
    }

    return msg
  })

  return { payload: clone, tokensSaved: totalSaved }
}

/**
 * Starts a native Headroom reverse proxy server using Bun.serve.
 */
export function startHeadroomProxy(options: ProxyOptions = {}) {
  const port = options.port || 8787
  const hostname = options.hostname || "127.0.0.1"
  const defaultUpstream = options.upstream || process.env.HEADROOM_UPSTREAM || ""
  const minChars = options.minChars || 600

  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url)
      const pathname = url.pathname

      // Health & Telemetry endpoints
      if (pathname === "/health" || pathname === "/stats" || pathname === "/") {
        const stats = getHeadroomTelemetry()
        return new Response(
          JSON.stringify(
            {
              status: "running",
              service: "Headroom AI Context Optimization Proxy",
              port,
              upstream: defaultUpstream || "(dynamic from client request headers)",
              telemetry: stats,
            },
            null,
            2,
          ),
          {
            headers: { "Content-Type": "application/json" },
          },
        )
      }

      // Handle OpenAI /v1/chat/completions
      if (pathname === "/v1/chat/completions" && req.method === "POST") {
        try {
          const body = await req.json()
          const { payload, tokensSaved } = compressOpenAiPayload(body, minChars)

          const targetUrl = defaultUpstream
            ? `${defaultUpstream.replace(/\/$/, "")}/chat/completions`
            : process.env.OPENAI_BASE_URL
              ? `${process.env.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`
              : "https://api.openai.com/v1/chat/completions"

          const upstreamHeaders = new Headers(req.headers)
          upstreamHeaders.set("Host", new URL(targetUrl).host)
          upstreamHeaders.delete("Content-Length")

          log.info("forwarding openai request", {
            tokensSaved,
            targetUrl,
          })

          const upstreamRes = await fetch(targetUrl, {
            method: "POST",
            headers: upstreamHeaders,
            body: JSON.stringify(payload),
          })

          const resHeaders = new Headers(upstreamRes.headers)
          resHeaders.set("X-Headroom-Tokens-Saved", String(tokensSaved))
          resHeaders.set("X-Headroom-Proxy", "1")

          return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            statusText: upstreamRes.statusText,
            headers: resHeaders,
          })
        } catch (err: any) {
          log.error("error proxying openai request", { error: err?.message })
          return new Response(JSON.stringify({ error: err?.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        }
      }

      // Handle Anthropic /v1/messages
      if (pathname === "/v1/messages" && req.method === "POST") {
        try {
          const body = await req.json()
          const { payload, tokensSaved } = compressAnthropicPayload(body, minChars)

          const targetUrl = defaultUpstream
            ? `${defaultUpstream.replace(/\/$/, "")}/messages`
            : process.env.ANTHROPIC_BASE_URL
              ? `${process.env.ANTHROPIC_BASE_URL.replace(/\/$/, "")}/messages`
              : "https://api.anthropic.com/v1/messages"

          const upstreamHeaders = new Headers(req.headers)
          upstreamHeaders.set("Host", new URL(targetUrl).host)
          upstreamHeaders.delete("Content-Length")

          log.info("forwarding anthropic request", {
            tokensSaved,
            targetUrl,
          })

          const upstreamRes = await fetch(targetUrl, {
            method: "POST",
            headers: upstreamHeaders,
            body: JSON.stringify(payload),
          })

          const resHeaders = new Headers(upstreamRes.headers)
          resHeaders.set("X-Headroom-Tokens-Saved", String(tokensSaved))
          resHeaders.set("X-Headroom-Proxy", "1")

          return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            statusText: upstreamRes.statusText,
            headers: resHeaders,
          })
        } catch (err: any) {
          log.error("error proxying anthropic request", { error: err?.message })
          return new Response(JSON.stringify({ error: err?.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        }
      }

      // Catch-all pass-through for other endpoints (e.g. /v1/models)
      if (defaultUpstream) {
        const targetUrl = `${defaultUpstream.replace(/\/$/, "")}${pathname}${url.search}`
        const upstreamHeaders = new Headers(req.headers)
        upstreamHeaders.set("Host", new URL(targetUrl).host)

        const upstreamRes = await fetch(targetUrl, {
          method: req.method,
          headers: upstreamHeaders,
          body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        })

        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          headers: upstreamRes.headers,
        })
      }

      return new Response("Headroom Proxy Ready. Send requests to /v1/chat/completions or /v1/messages", {
        status: 200,
      })
    },
  })

  return server
}
