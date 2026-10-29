/**
 * Headroom AI Model Context Protocol (MCP) Server
 * Exposes Headroom Context Compression, CCR Store, and Telemetry over standard stdio JSON-RPC 2.0.
 */

import readline from "node:readline"
import {
  compressContext,
  compressAuto,
  retrieveCcr,
  normalizeCcrKey,
  getHeadroomTelemetry,
} from "./headroom"

export interface JsonRpcRequest {
  jsonrpc: string
  id?: string | number
  method: string
  params?: any
}

export function handleMcpMessage(msg: JsonRpcRequest): any {
  const { id, method, params } = msg

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "navi-headroom",
          version: "1.0.0",
        },
      },
    }
  }

  if (method === "notifications/initialized") {
    return null
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "headroom_compress",
            description:
              "Compress verbose context (logs, diffs, JSON, code skeletons) using native Rust algorithms. Caches original in CCR store and returns <<ccr:key>>.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string", description: "The text to compress" },
                type: {
                  type: "string",
                  enum: ["auto", "log", "diff", "json", "code"],
                  description: "Compression mode (default: auto)",
                },
              },
              required: ["text"],
            },
          },
          {
            name: "headroom_retrieve",
            description:
              "Retrieve original uncompressed text from Headroom CCR store using its 24-character hash key.",
            inputSchema: {
              type: "object",
              properties: {
                key: { type: "string", description: "CCR retrieval key" },
              },
              required: ["key"],
            },
          },
          {
            name: "headroom_stats",
            description:
              "Retrieve real-time compression telemetry and tokens saved from Headroom engine.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    }
  }

  if (method === "tools/call") {
    const name = params?.name
    const args = params?.arguments || {}

    if (name === "headroom_compress") {
      const text = String(args.text || "")
      const type = args.type || "auto"

      const outcome =
        type === "auto"
          ? compressAuto(text, 100)
          : compressContext(type, text)

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  compressed: outcome.compressed,
                  ccr_key: outcome.ccr_key,
                  original_len: outcome.original_len,
                  compressed_len: outcome.compressed_len,
                  tokens_saved_est: outcome.tokens_saved_est,
                  savings_pct: `${((1 - outcome.compression_ratio) * 100).toFixed(1)}%`,
                },
                null,
                2,
              ),
            },
          ],
        },
      }
    }

    if (name === "headroom_retrieve") {
      const key = normalizeCcrKey(String(args.key || ""))
      const original = retrieveCcr(key)

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: original || `[Error] No content found in CCR store for key: "${key}"`,
            },
          ],
        },
      }
    }

    if (name === "headroom_stats") {
      const stats = getHeadroomTelemetry()
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(stats, null, 2),
            },
          ],
        },
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method '${name}' not found`,
      },
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Unknown method '${method}'`,
    },
  }
}

/**
 * Starts the Headroom MCP server over stdio.
 */
export function startHeadroomMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  rl.on("line", (line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest
      const response = handleMcpMessage(req)
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n")
      }
    } catch (err: any) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error: " + (err?.message || "invalid JSON"),
          },
        }) + "\n",
      )
    }
  })
}
