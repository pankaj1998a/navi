import http, { type IncomingMessage, type ServerResponse } from "http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { bridgeTools, type ToolContext } from "./tools"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "bridge.server" })

export interface BridgeServerOptions {
  port: number
  authToken: string
  workspaceRoot: string
  onToolCall?: (toolName: string, args: Record<string, unknown>, resultText: string) => void
}

export interface BridgeServerInstance {
  port: number
  authToken: string
  workspaceRoot: string
  close: () => Promise<void>
}

export async function createBridgeServer(options: BridgeServerOptions): Promise<BridgeServerInstance> {
  const { port, authToken, workspaceRoot, onToolCall } = options

  const toolCtx: ToolContext = {
    workspaceRoot,
    onActivity: onToolCall,
  }

  function initMcpServer(): McpServer {
    const s = new McpServer(
      {
        name: "navi-bridge",
        version: "2.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    // Register all workspace tools
    for (const tool of bridgeTools) {
      s.tool(tool.name, tool.description, tool.parameters.shape, async (args: any) => {
        log.info("executing tool via bridge", { tool: tool.name })
        const res = await tool.execute(args, toolCtx)
        const outText = res.content.map((c) => c.text).join("\n")
        if (onToolCall) {
          onToolCall(tool.name, args, outText)
        }
        return res
      })
    }
    return s
  }

  // Active SSE transports keyed by session ID
  const sseTransports = new Map<string, { transport: SSEServerTransport; mcp: McpServer }>()

  // Streamable HTTP transport
  const streamableTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  })
  const streamableMcp = initMcpServer()
  await streamableMcp.connect(streamableTransport)

  function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
    if (!authToken) {
      return true
    }
    const authHeader = req.headers.authorization
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    const tokenQuery = url.searchParams.get("token")

    let providedToken: string | undefined
    if (authHeader && authHeader.startsWith("Bearer ")) {
      providedToken = authHeader.slice(7).trim()
    } else if (tokenQuery) {
      providedToken = tokenQuery
    }

    if (!providedToken || providedToken !== authToken) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing Bearer token" }))
      return false
    }
    return true
  }

  const server = http.createServer(async (req, res) => {
    // CORS headers for web AI chats
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
    res.setHeader("Access-Control-Allow-Headers", "*")
    res.setHeader("Access-Control-Expose-Headers", "*")

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    const pathname = url.pathname
    const acceptHeader = req.headers.accept || ""

    // Health check
    if (pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          status: "online",
          service: "navi-web-bridge",
          version: "2.0.0",
          toolsCount: bridgeTools.length,
          endpoints: {
            sse: "/sse",
            messages: "/messages",
            mcp: "/mcp",
          },
        }),
      )
      return
    }

    // Authenticate all MCP protocol requests
    if (!checkAuth(req, res)) {
      return
    }

    // ── 1. SSE Transport (Claude.ai / ChatGPT web connectors) ──────────────────
    const isSseRequest = pathname === "/sse" || (pathname === "/" && acceptHeader.includes("text/event-stream"))
    if (isSseRequest && req.method === "GET") {
      log.info("new SSE client connected", { path: pathname })
      const transport = new SSEServerTransport("/messages", res)
      const sessionId = (transport as any)._sessionId || crypto.randomUUID()
      const sessionMcp = initMcpServer()
      sseTransports.set(sessionId, { transport, mcp: sessionMcp })

      transport.onclose = () => {
        sseTransports.delete(sessionId)
        sessionMcp.close().catch(() => {})
      }

      await sessionMcp.connect(transport)
      return
    }

    if (pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId")
      const entry = sessionId ? sseTransports.get(sessionId) : sseTransports.values().next().value

      if (!entry) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Session not found or expired" }))
        return
      }

      await entry.transport.handlePostMessage(req, res)
      return
    }

    // ── 2. Streamable HTTP Transport (/mcp or POST /) ─────────────────────────
    if (pathname === "/mcp" || pathname.startsWith("/mcp/") || (pathname === "/" && req.method === "POST")) {
      await (streamableTransport as any).handleRequest(req, res)
      return
    }

    // Root GET without SSE accept header: return discovery info
    if (pathname === "/") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          status: "online",
          service: "navi-web-bridge",
          version: "2.0.0",
          toolsCount: bridgeTools.length,
          endpoints: {
            sse: "/sse",
            messages: "/messages",
            mcp: "/mcp",
          },
        }),
      )
      return
    }

    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not Found" }))
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "0.0.0.0", () => {
      resolve()
    })
    server.on("error", reject)
  })

  const addr = server.address()
  const actualPort = typeof addr === "object" && addr ? addr.port : port

  log.info("bridge server listening", { port: actualPort })

  return {
    port: actualPort,
    authToken,
    workspaceRoot,
    close: async () => {
      for (const entry of sseTransports.values()) {
        await entry.mcp.close().catch(() => {})
      }
      sseTransports.clear()
      await streamableMcp.close().catch(() => {})
      return new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}
