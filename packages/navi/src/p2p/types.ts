import { z } from "zod"
import { BusEvent } from "@/bus/bus-event"

/**
 * P2P Types for Navi Terminal-to-Terminal Communication
 */

// Unique identifier for a Navi peer
export const PeerId = z.string().min(1).max(64)
export type PeerId = z.infer<typeof PeerId>

// Peer information schema
export const PeerInfo = z.object({
  id: PeerId.describe("Unique peer identifier"),
  name: z.string().describe("Human-readable peer name"),
  hostname: z.string().describe("Hostname or IP address"),
  port: z.number().int().positive().describe("Port number"),
  version: z.string().optional().describe("Navi version"),
  workspaces: z.array(z.string()).optional().describe("Projects the peer is working on"),
  capabilities: z.array(z.string()).optional().describe("Available capabilities"),
  lastSeen: z.number().optional().describe("Last seen timestamp (ms)"),
  status: z.enum(["online", "offline", "busy"]).optional().default("online"),
})
export type PeerInfo = z.infer<typeof PeerInfo>

// Peer discovery event
export const PeerDiscoveryEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("peer.joined"),
    peer: PeerInfo,
  }),
  z.object({
    type: z.literal("peer.left"),
    peerId: PeerId,
  }),
  z.object({
    type: z.literal("peer.updated"),
    peer: PeerInfo,
  }),
])
export type PeerDiscoveryEvent = z.infer<typeof PeerDiscoveryEvent>

// P2P Message types
export const P2PMessage = z.discriminatedUnion("type", [
  // Request help from a peer
  z.object({
    type: z.literal("help.request"),
    id: z.string().describe("Unique request ID"),
    from: PeerId,
    task: z.string().describe("Task description"),
    context: z.string().optional().describe("Additional context"),
    files: z.array(z.object({
      path: z.string(),
      content: z.string().optional(),
    })).optional().describe("Related files"),
    timestamp: z.number(),
  }),
  // Response to help request
  z.object({
    type: z.literal("help.response"),
    id: z.string().describe("Request ID being responded to"),
    from: PeerId,
    result: z.string().describe("Result or response"),
    success: z.boolean(),
    error: z.string().optional(),
    timestamp: z.number(),
  }),
  // Share context with peer
  z.object({
    type: z.literal("context.share"),
    id: z.string(),
    from: PeerId,
    files: z.array(z.object({
      path: z.string(),
      content: z.string(),
    })),
    sessionID: z.string().optional(),
    timestamp: z.number(),
  }),
  // Sync session
  z.object({
    type: z.literal("session.sync"),
    id: z.string(),
    from: PeerId,
    sessionID: z.string(),
    messages: z.array(z.any()).optional(),
    timestamp: z.number(),
  }),
  // Collaborative session
  z.object({
    type: z.literal("collab.invite"),
    id: z.string(),
    from: PeerId,
    sessionID: z.string(),
    projectPath: z.string(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("collab.join"),
    id: z.string(),
    from: PeerId,
    sessionID: z.string(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("collab.leave"),
    id: z.string(),
    from: PeerId,
    sessionID: z.string(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("collab.edit"),
    id: z.string(),
    from: PeerId,
    sessionID: z.string(),
    file: z.string(),
    changes: z.array(z.object({
      startLine: z.number(),
      endLine: z.number(),
      newText: z.string(),
    })),
    timestamp: z.number(),
  }),
  // Ping/Pong for keepalive
  z.object({
    type: z.literal("ping"),
    id: z.string(),
    from: PeerId,
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("pong"),
    id: z.string(),
    from: PeerId,
    timestamp: z.number(),
  }),
])
export type P2PMessage = z.infer<typeof P2PMessage>

// Connection state
export const ConnectionState = z.enum(["disconnected", "connecting", "connected", "error"])
export type ConnectionState = z.infer<typeof ConnectionState>

// P2P Configuration
export const P2PConfig = z.object({
  enabled: z.boolean().default(true),
  discovery: z.object({
    mdns: z.boolean().default(true),
    interval: z.number().default(30000),
  }).default({ mdns: true, interval: 30000 }),
  security: z.object({
    requireAuth: z.boolean().default(false),
    allowedPeers: z.array(PeerId).default([]),
    blockedPeers: z.array(PeerId).default([]),
    secret: z.string().optional(),
  }).default({ requireAuth: false, allowedPeers: [], blockedPeers: [] }),
  capabilities: z.object({
    acceptTasks: z.boolean().default(true),
    shareFiles: z.boolean().default(true),
    collaborate: z.boolean().default(true),
  }).default({ acceptTasks: true, shareFiles: true, collaborate: true }),
})
export type P2PConfig = z.infer<typeof P2PConfig>

// Bus events for P2P
export namespace P2PEvent {
  export const PeerJoined = BusEvent.define("p2p.peer.joined", z.object({ peer: PeerInfo }))
  export const PeerLeft = BusEvent.define("p2p.peer.left", z.object({ peerId: PeerId }))
  export const MessageReceived = BusEvent.define("p2p.message.received", z.object({ 
    from: PeerId, 
    message: P2PMessage 
  }))
  export const ConnectionStateChanged = BusEvent.define("p2p.connection.state", z.object({
    peerId: PeerId,
    state: ConnectionState,
  }))
}

