import { Log } from "@/util/log"
import { PeerInfo, PeerId, P2PMessage, P2PConfig, ConnectionState } from "./types"
import { P2PDiscovery } from "./discovery"
import { v4 as uuidv4 } from "uuid"
import { z } from "zod"
import { GlobalBus } from "@/bus/global"

const log = Log.create({ service: "p2p-client" })

// Request timeout in milliseconds
const REQUEST_TIMEOUT = 60000

// Pending request tracking
interface PendingRequest {
  resolve: (result: any) => void
  reject: (error: Error) => void
  timestamp: number
  timeout: Timer
}

/**
 * P2P Client Module
 * 
 * Handles outbound connections and requests to other Navi peers.
 */
export namespace P2PClient {
  // Pending requests waiting for responses
  const pendingRequests = new Map<string, PendingRequest>()
  
  // Connection states for peers
  const connectionStates = new Map<string, ConnectionState>()
  
  // Configuration
  let config: P2PConfig | undefined

  /**
   * Initialize the P2P client
   */
  export function init(p2pConfig: P2PConfig): void {
    config = p2pConfig
    log.info("P2P client initialized")
  }

  /**
   * Get the base URL for a peer
   */
  function getPeerUrl(peer: PeerInfo): string {
    return `http://${peer.hostname}:${peer.port}`
  }

  /**
   * Get connection state for a peer
   */
  export function getConnectionState(peerId: string): ConnectionState {
    return connectionStates.get(peerId) || "disconnected"
  }

  /**
   * Send a message to a peer and wait for response
   */
  async function sendRequest<T>(
    peer: PeerInfo, 
    message: Partial<P2PMessage> & { type: P2PMessage["type"] }
  ): Promise<T> {
    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      throw new Error("Self info not available - is P2P discovery initialized?")
    }

    const messageId = uuidv4()
    const fullMessage: P2PMessage = {
      ...message,
      id: messageId,
      from: selfInfo.id,
      timestamp: Date.now(),
    } as P2PMessage

    // Create pending request
    const requestPromise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(messageId)
        reject(new Error(`Request timeout: ${message.type}`))
      }, REQUEST_TIMEOUT)

      pendingRequests.set(messageId, {
        resolve: resolve as (result: any) => void,
        reject,
        timestamp: Date.now(),
        timeout,
      })
    })

    // Send request
    try {
      connectionStates.set(peer.id, "connecting")
      
      const response = await fetch(`${getPeerUrl(peer)}/p2p/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Navi-Peer-Id": selfInfo.id,
          ...(config?.security.secret ? { "X-Navi-Auth": config.security.secret } : {}),
        },
        body: JSON.stringify(fullMessage),
      })

      if (!response.ok) {
        connectionStates.set(peer.id, "error")
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }

      connectionStates.set(peer.id, "connected")
      
      // For messages that expect an immediate response
      const contentType = response.headers.get("content-type")
      if (contentType?.includes("application/json")) {
        const data = await response.json()
        return data as T
      }

      return requestPromise
    } catch (error) {
      connectionStates.set(peer.id, "error")
      pendingRequests.delete(messageId)
      throw error
    }
  }

  /**
   * Handle incoming response
   */
  export function handleResponse(response: Extract<P2PMessage, { type: "help.response" }>): void {
    const pending = pendingRequests.get(response.id)
    if (!pending) {
      log.warn("Received response for unknown request", { id: response.id })
      return
    }

    clearTimeout(pending.timeout)
    pendingRequests.delete(response.id)

    if (response.success) {
      pending.resolve(response)
    } else {
      pending.reject(new Error(response.error || "Request failed"))
    }
  }

  /**
   * Request help from a peer
   */
  export async function requestHelp(params: {
    peer: PeerInfo
    task: string
    context?: string
    files?: Array<{ path: string; content?: string }>
  }): Promise<{ result: string }> {
    const response = await sendRequest<{ result: string }>(params.peer, {
      type: "help.request",
      task: params.task,
      context: params.context,
      files: params.files,
    })

    return response
  }

  /**
   * Share context with a peer
   */
  export async function shareContext(params: {
    peer: PeerInfo
    files: Array<{ path: string; content: string }>
    sessionID?: string
  }): Promise<void> {
    await sendRequest(params.peer, {
      type: "context.share",
      files: params.files,
      sessionID: params.sessionID,
    })
  }

  /**
   * Sync session with a peer
   */
  export async function syncSession(params: {
    peer: PeerInfo
    sessionID: string
    messages?: any[]
  }): Promise<void> {
    await sendRequest(params.peer, {
      type: "session.sync",
      sessionID: params.sessionID,
      messages: params.messages,
    })
  }

  /**
   * Invite a peer to collaborate
   */
  export async function inviteToCollab(params: {
    peer: PeerInfo
    sessionID: string
    projectPath: string
  }): Promise<void> {
    await sendRequest(params.peer, {
      type: "collab.invite",
      sessionID: params.sessionID,
      projectPath: params.projectPath,
    })
  }

  /**
   * Join a collaborative session
   */
  export async function joinCollab(params: {
    peer: PeerInfo
    sessionID: string
  }): Promise<void> {
    await sendRequest(params.peer, {
      type: "collab.join",
      sessionID: params.sessionID,
    })
  }

  /**
   * Leave a collaborative session
   */
  export async function leaveCollab(params: {
    peer: PeerInfo
    sessionID: string
  }): Promise<void> {
    await sendRequest(params.peer, {
      type: "collab.leave",
      sessionID: params.sessionID,
    })
  }

  /**
   * Send edit changes to collaborative session
   */
  export async function sendEdit(params: {
    peer: PeerInfo
    sessionID: string
    file: string
    changes: Array<{ startLine: number; endLine: number; newText: string }>
  }): Promise<void> {
    await sendRequest(params.peer, {
      type: "collab.edit",
      sessionID: params.sessionID,
      file: params.file,
      changes: params.changes,
    })
  }

  /**
   * Ping a peer to check connectivity
   */
  export async function ping(peer: PeerInfo): Promise<number> {
    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      throw new Error("Self info not available")
    }

    const start = Date.now()
    const messageId = uuidv4()
    
    const response = await fetch(`${getPeerUrl(peer)}/p2p/ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Navi-Peer-Id": selfInfo.id,
      },
      body: JSON.stringify({
        type: "ping",
        id: messageId,
        from: selfInfo.id,
        timestamp: start,
      } satisfies P2PMessage),
    })

    if (!response.ok) {
      throw new Error(`Ping failed: ${response.status}`)
    }

    return Date.now() - start
  }

  /**
   * Broadcast a message to all peers
   */
  export async function broadcast(params: {
    task: string
    context?: string
  }): Promise<Array<{ peerId: string; result?: string; error?: string }>> {
    const peers = P2PDiscovery.getPeers()
    const results: Array<{ peerId: string; result?: string; error?: string }> = []

    const promises = peers
      .filter((peer) => {
        // Skip blocked peers
        if (config?.security.blockedPeers.includes(peer.id)) return false
        // Skip if allowed list exists and peer not in it
        if (config?.security.allowedPeers.length && !config.security.allowedPeers.includes(peer.id)) return false
        return true
      })
      .map(async (peer) => {
        try {
          const response = await requestHelp({
            peer,
            task: params.task,
            context: params.context,
          })
          results.push({ peerId: peer.id, result: response.result })
        } catch (error) {
          results.push({ 
            peerId: peer.id, 
            error: error instanceof Error ? error.message : String(error) 
          })
        }
      })

    await Promise.allSettled(promises)
    return results
  }

  /**
   * Get the best peer for a task
   * (simple heuristic based on status and capabilities)
   */
  export function getBestPeerForTask(task: string): PeerInfo | undefined {
    const peers = P2PDiscovery.getPeers()
    
    // Filter available peers
    const available = peers.filter((peer) => {
      if (peer.status !== "online") return false
      if (config?.security.blockedPeers.includes(peer.id)) return false
      if (config?.security.allowedPeers.length && !config.security.allowedPeers.includes(peer.id)) return false
      return true
    })

    if (available.length === 0) return undefined

    // Simple heuristic: prefer peers with accept-tasks capability
    const withCapability = available.filter((p) => 
      p.capabilities?.includes("accept-tasks")
    )

    return withCapability[0] || available[0]
  }

  /**
   * Cleanup pending requests on shutdown
   */
  export function cleanup(): void {
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("P2P client shutting down"))
    }
    pendingRequests.clear()
    connectionStates.clear()
    log.info("P2P client cleaned up")
  }
}

