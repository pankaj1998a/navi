import { Log } from "@/util/log"
import { PeerInfo, PeerId, P2PMessage, P2PConfig, P2PEvent } from "./types"
import { P2PDiscovery } from "./discovery"
import { P2PClient } from "./client"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { streamSSE } from "hono/streaming"
import { GlobalBus } from "@/bus/global"
import { Session } from "@/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { v4 as uuidv4 } from "uuid"

const log = Log.create({ service: "p2p-server" })

// Active collaborative sessions
interface CollabSession {
  id: string
  host: PeerId
  participants: Set<PeerId>
  projectPath: string
  files: Map<string, string>
}

/**
 * P2P Server Module
 * 
 * Handles inbound P2P requests from other Navi instances.
 * Provides HTTP endpoints for peer communication.
 */
export namespace P2PServer {
  // Configuration
  let config: P2PConfig | undefined
  
  // Active collaborative sessions (hosted by this instance)
  const collabSessions = new Map<string, CollabSession>()
  
  // Joined collaborative sessions (hosted by others)
  const joinedSessions = new Map<string, { sessionID: string; host: PeerId }>()

  // Hono router for P2P endpoints
  export const router = new Hono()

  /**
   * Initialize the P2P server
   */
  export function init(p2pConfig: P2PConfig): void {
    config = p2pConfig
    setupRoutes()
    log.info("P2P server initialized")
  }

  /**
   * Setup P2P API routes
   */
  function setupRoutes(): void {
    // Health check endpoint
    router.get(
      "/health",
      describeRoute({
        summary: "P2P Health check",
        description: "Check if P2P server is running",
        operationId: "p2p.health",
        responses: {
          200: {
            description: "Healthy",
            content: {
              "application/json": {
                schema: resolver(z.object({ 
                  healthy: z.boolean(), 
                  peerId: z.string() 
                })),
              },
            },
          },
        },
      }),
      (c) => {
        const selfInfo = P2PDiscovery.getSelfInfo()
        return c.json({ 
          healthy: true, 
          peerId: selfInfo?.id || "unknown" 
        })
      }
    )

    // Main message endpoint
    router.post(
      "/message",
      describeRoute({
        summary: "Receive P2P message",
        description: "Handle incoming P2P messages from other Navi instances",
        operationId: "p2p.message",
        responses: {
          200: {
            description: "Message processed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
        },
      }),
      async (c) => {
        // Verify peer authentication if required
        if (config?.security.requireAuth) {
          const authHeader = c.req.header("X-Navi-Auth")
          if (authHeader !== config.security.secret) {
            return c.json({ error: "Unauthorized" }, 401)
          }
        }

        const message = await c.req.json<P2PMessage>()
        const fromPeerId = c.req.header("X-Navi-Peer-Id") || message.from

        // Check if peer is blocked
        if (config?.security.blockedPeers.includes(fromPeerId)) {
          return c.json({ error: "Peer blocked" }, 403)
        }

        // Emit event for message received
        GlobalBus.emit("event", {
          payload: {
            type: "p2p.message.received",
            properties: { from: fromPeerId, message },
          },
        })

        // Handle message based on type
        const response = await handleMessage(fromPeerId, message)
        
        return c.json(response || { success: true })
      }
    )

    // Ping endpoint
    router.post(
      "/ping",
      describeRoute({
        summary: "Ping",
        description: "Check connectivity and latency",
        operationId: "p2p.ping",
        responses: {
          200: {
            description: "Pong",
            content: {
              "application/json": {
                schema: resolver(z.object({ 
                  pong: z.boolean(), 
                  timestamp: z.number() 
                })),
              },
            },
          },
        },
      }),
      async (c) => {
        const body = await c.req.json<P2PMessage>()
        return c.json({
          pong: true,
          timestamp: Date.now(),
          receivedTimestamp: body.timestamp,
        })
      }
    )

    // Get peer info
    router.get(
      "/info",
      describeRoute({
        summary: "Get peer info",
        description: "Get information about this Navi instance",
        operationId: "p2p.info",
        responses: {
          200: {
            description: "Peer info",
            content: {
              "application/json": {
                schema: resolver(PeerInfo),
              },
            },
          },
        },
      }),
      (c) => {
        const selfInfo = P2PDiscovery.getSelfInfo()
        if (!selfInfo) {
          return c.json({ error: "Not available" }, 503)
        }
        return c.json(selfInfo)
      }
    )

    // List collaborative sessions
    router.get(
      "/collab",
      describeRoute({
        summary: "List collaborative sessions",
        description: "List active collaborative sessions on this peer",
        operationId: "p2p.collab.list",
        responses: {
          200: {
            description: "Sessions",
            content: {
              "application/json": {
                schema: resolver(z.array(z.object({
                  id: z.string(),
                  host: z.string(),
                  participants: z.array(z.string()),
                  projectPath: z.string(),
                }))),
              },
            },
          },
        },
      }),
      (c) => {
        const sessions = Array.from(collabSessions.values()).map((s) => ({
          id: s.id,
          host: s.host,
          participants: Array.from(s.participants),
          projectPath: s.projectPath,
        }))
        return c.json(sessions)
      }
    )

    // Events stream (SSE)
    router.get(
      "/events",
      describeRoute({
        summary: "P2P Event stream",
        description: "Subscribe to P2P events via Server-Sent Events",
        operationId: "p2p.events",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      async (c) => {
        return streamSSE(c, async (stream) => {
          // Send initial connection message
          stream.writeSSE({
            data: JSON.stringify({ type: "connected" }),
          })

          // Subscribe to P2P events
          const handlers: Array<() => void> = []

          // Peer joined
          handlers.push(
            P2PDiscovery.onPeerJoined((peer) => {
              stream.writeSSE({
                data: JSON.stringify({ type: "peer.joined", peer }),
              })
            })
          )

          // Peer left
          handlers.push(
            P2PDiscovery.onPeerLeft((peerId) => {
              stream.writeSSE({
                data: JSON.stringify({ type: "peer.left", peerId }),
              })
            })
          )

          // Keep connection alive
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify({ type: "heartbeat" }),
            })
          }, 30000)

          // Wait for abort
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              handlers.forEach((unsub) => unsub())
              resolve()
            })
          })
        })
      }
    )
  }

  /**
   * Handle incoming P2P message
   */
  async function handleMessage(fromPeerId: PeerId, message: P2PMessage): Promise<any> {
    log.info("Received message", { type: message.type, from: fromPeerId })

    switch (message.type) {
      case "help.request":
        return handleHelpRequest(fromPeerId, message)

      case "context.share":
        return handleContextShare(fromPeerId, message)

      case "session.sync":
        return handleSessionSync(fromPeerId, message)

      case "collab.invite":
        return handleCollabInvite(fromPeerId, message)

      case "collab.join":
        return handleCollabJoin(fromPeerId, message)

      case "collab.leave":
        return handleCollabLeave(fromPeerId, message)

      case "collab.edit":
        return handleCollabEdit(fromPeerId, message)

      case "help.response":
        // Forward to client module
        P2PClient.handleResponse(message)
        return { success: true }

      default:
        log.warn("Unknown message type", { type: (message as any).type })
        return { error: "Unknown message type" }
    }
  }

  /**
   * Handle help request from a peer
   */
  async function handleHelpRequest(
    fromPeerId: PeerId, 
    message: Extract<P2PMessage, { type: "help.request" }>
  ): Promise<any> {
    if (!config?.capabilities.acceptTasks) {
      return {
        type: "help.response",
        id: message.id,
        from: P2PDiscovery.getSelfInfo()?.id,
        result: "",
        success: false,
        error: "This peer does not accept tasks",
        timestamp: Date.now(),
      }
    }

    try {
      // Set status to busy
      P2PDiscovery.setStatus("busy")

      // Create a session for this request
      const session = await Session.create({
        title: `P2P Help: ${message.task.slice(0, 50)}...`,
      })

      // Build the prompt with context
      let prompt = message.task
      if (message.context) {
        prompt = `Context:\n${message.context}\n\nTask:\n${message.task}`
      }
      if (message.files && message.files.length > 0) {
        prompt += "\n\nRelated files:\n"
        for (const file of message.files) {
          prompt += `\n### ${file.path}\n${file.content || "(content not provided)"}\n`
        }
      }

      // Get default agent and model
      const agent = await Agent.defaultAgent()
      const defaultModel = await Provider.defaultModel()

      // Send the prompt (async - we'll stream the result)
      SessionPrompt.prompt({
        sessionID: session.id,
        parts: [{ type: "text", text: prompt }],
        agent,
        model: {
          providerID: defaultModel.providerID,
          modelID: defaultModel.modelID,
        },
      })

      // For now, return immediately with session info
      // The peer can poll or subscribe to get the result
      // TODO: Implement streaming response or webhooks
      
      return {
        type: "help.response",
        id: message.id,
        from: P2PDiscovery.getSelfInfo()?.id,
        result: `Task accepted. Session ID: ${session.id}`,
        success: true,
        timestamp: Date.now(),
        sessionID: session.id,
      }
    } catch (error) {
      log.error("Failed to handle help request", { error })
      
      return {
        type: "help.response",
        id: message.id,
        from: P2PDiscovery.getSelfInfo()?.id,
        result: "",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      }
    } finally {
      // Reset status
      P2PDiscovery.setStatus("online")
    }
  }

  /**
   * Handle context share from a peer
   */
  async function handleContextShare(
    fromPeerId: PeerId, 
    message: Extract<P2PMessage, { type: "context.share" }>
  ): Promise<any> {
    if (!config?.capabilities.shareFiles) {
      return { error: "This peer does not accept file shares" }
    }

    log.info("Received context share", { 
      from: fromPeerId, 
      fileCount: message.files.length 
    })

    // Store shared files (in memory for now)
    // Could be extended to write to a temp directory
    
    return { 
      success: true, 
      filesReceived: message.files.length,
    }
  }

  /**
   * Handle session sync from a peer
   */
  async function handleSessionSync(
    fromPeerId: PeerId, 
    message: Extract<P2PMessage, { type: "session.sync" }>
  ): Promise<any> {
    log.info("Received session sync", { 
      from: fromPeerId, 
      sessionID: message.sessionID 
    })

    // Could be used to replicate session state
    // For now, just acknowledge
    
    return { success: true }
  }

  /**
   * Handle collaboration invite from a peer
   */
  async function handleCollabInvite(
    fromPeerId: PeerId, 
    message: Extract<P2PMessage, { type: "collab.invite" }>
  ): Promise<any> {
    if (!config?.capabilities.collaborate) {
      return { error: "This peer does not support collaboration" }
    }

    log.info("Received collab invite", { 
      from: fromPeerId, 
      sessionID: message.sessionID,
      projectPath: message.projectPath,
    })

    // Store invite for user to accept
    joinedSessions.set(message.sessionID, {
      sessionID: message.sessionID,
      host: fromPeerId,
    })

    return { success: true }
  }

  /**
   * Handle collaboration join from a peer
   */
  async function handleCollabJoin(
    fromPeerId: PeerId, 
    message: Extract<P2PMessage, { type: "collab.join" }>
  ): Promise<any> {
    const session = collabSessions.get(message.sessionID)
    if (!session) {
      return { error: "Session not found" }
    }

    session.participants.add(fromPeerId)
    
    log.info("Peer joined collab session", { 
      peer: fromPeerId, 
      sessionID: message.sessionID 
    })

    return { 
      success: true, 
      participants: Array.from(session.participants),
    }
  }

  /**
   * Handle collaboration leave from a peer
   */
  async function handleCollabLeave(
    fromPeerId: PeerId, 
    message: Extract<P2PMessage, { type: "collab.leave" }>
  ): Promise<any> {
    const session = collabSessions.get(message.sessionID)
    if (session) {
      session.participants.delete(fromPeerId)
      log.info("Peer left collab session", { 
        peer: fromPeerId, 
        sessionID: message.sessionID 
      })
    }

    return { success: true }
  }

  /**
   * Handle collaborative edit from a peer
   */
  async function handleCollabEdit(
    fromPeerId: PeerId, 
    message: Extract<P2PMessage, { type: "collab.edit" }>
  ): Promise<any> {
    const session = collabSessions.get(message.sessionID)
    if (!session) {
      return { error: "Session not found" }
    }

    if (!session.participants.has(fromPeerId)) {
      return { error: "Not a participant" }
    }

    // Apply edit to file
    // This is a simplified implementation
    log.info("Received collab edit", { 
      from: fromPeerId, 
      file: message.file,
      changes: message.changes.length,
    })

    // Emit event for UI to handle
    GlobalBus.emit("event", {
      payload: {
        type: "p2p.collab.edit",
        properties: message,
      },
    })

    return { success: true }
  }

  /**
   * Create a collaborative session
   */
  export function createCollabSession(projectPath: string): CollabSession {
    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      throw new Error("Self info not available")
    }

    const id = uuidv4()
    const session: CollabSession = {
      id,
      host: selfInfo.id,
      participants: new Set([selfInfo.id]),
      projectPath,
      files: new Map(),
    }

    collabSessions.set(id, session)
    log.info("Created collab session", { sessionID: id, projectPath })

    return session
  }

  /**
   * Get active collaborative sessions
   */
  export function getCollabSessions(): CollabSession[] {
    return Array.from(collabSessions.values())
  }

  /**
   * Cleanup on shutdown
   */
  export function cleanup(): void {
    collabSessions.clear()
    joinedSessions.clear()
    log.info("P2P server cleaned up")
  }
}

