import { z } from "zod"
import { Tool } from "./tool"
import { P2PDiscovery, P2PClient, type PeerInfo } from "@/p2p"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool:delegate-peer" })

// Define parameters schemas separately
const DelegatePeerParams = z.object({
  task: z.string().describe("The task to delegate to the peer"),
  peerId: z.string().optional().describe("Specific peer ID to use (optional, will auto-select if not provided)"),
  context: z.string().optional().describe("Additional context to help the peer understand the task"),
  files: z.array(z.object({
    path: z.string().describe("File path"),
    content: z.string().optional().describe("File content (if not provided, peer may need to read the file)"),
  })).optional().describe("Files relevant to the task"),
  timeout: z.number().optional().default(60000).describe("Timeout in milliseconds (default: 60000)"),
})

const BroadcastParams = z.object({
  task: z.string().describe("The task to broadcast to all peers"),
  context: z.string().optional().describe("Additional context"),
})

const ListPeersParams = z.object({})

/**
 * Delegate to Peer Tool
 */
export const DelegateToPeerTool = Tool.define("delegate_to_peer", {
  description: `Delegate a task to another Navi instance on the network.

Use this tool when:
- You need to parallelize work across multiple Navi instances
- You want to ask another Navi for help with a specific task
- The current Navi is busy and another instance can help
- You need a second opinion or review from another Navi

The tool will:
1. Find an available peer (or use the specified peer)
2. Send the task to the peer
3. Return the peer's response`,
  parameters: DelegatePeerParams,
  async execute(params: z.infer<typeof DelegatePeerParams>, ctx) {
    log.info("Delegating task to peer", { task: params.task.slice(0, 100), peerId: params.peerId })
    ctx.metadata({ title: `Delegating to peer: ${params.task.slice(0, 50)}...` })

    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      return {
        title: "P2P not initialized",
        output: "P2P not initialized. Start with 'navi peers start' or enable P2P in config.",
        metadata: { success: false },
      } as any
    }

    let peer: PeerInfo | undefined = params.peerId ? P2PDiscovery.getPeer(params.peerId) : undefined

    if (params.peerId && !peer) {
      return {
        title: "Peer not found",
        output: `Peer not found: ${params.peerId}`,
        metadata: { success: false, peerId: params.peerId },
      } as any
    }

    if (!peer) {
      peer = P2PClient.getBestPeerForTask(params.task)
    }

    if (!peer) {
      return {
        title: "No peers available",
        output: "No available peers found. Ensure other Navi instances are running with P2P enabled.",
        metadata: { success: false },
      } as any
    }

    if (!peer.capabilities?.includes("accept-tasks")) {
      return {
        title: "Peer does not accept tasks",
        output: `Peer ${peer.name} does not accept tasks`,
        metadata: { success: false, peerId: peer.id, peerName: peer.name },
      } as any
    }

    try {
      const response = await P2PClient.requestHelp({
        peer,
        task: params.task,
        context: params.context,
        files: params.files,
      })
      log.info("Task delegated successfully", { peerId: peer.id })

      return {
        title: `Response from ${peer.name}`,
        output: response.result,
        metadata: { success: true, peerId: peer.id, peerName: peer.name, sessionId: (response as any).sessionId },
      } as any
    } catch (error) {
      log.error("Failed to delegate task", { error, peerId: peer.id })
      return {
        title: "Delegation failed",
        output: error instanceof Error ? error.message : String(error),
        metadata: { success: false, peerId: peer.id, peerName: peer.name, error: error instanceof Error ? error.message : String(error) },
      } as any
    }
  },
})

/**
 * Broadcast to Peers Tool
 */
export const BroadcastToPeersTool = Tool.define("broadcast_to_peers", {
  description: `Broadcast a task to all available Navi peers on the network.

Use this tool when you need:
- Multiple perspectives on a problem
- Parallel processing of independent tasks
- Consensus across multiple Navis

Returns responses from all available peers.`,
  parameters: BroadcastParams,
  async execute(params: z.infer<typeof BroadcastParams>, ctx) {
    log.info("Broadcasting task to peers", { task: params.task.slice(0, 100) })
    ctx.metadata({ title: `Broadcasting to all peers: ${params.task.slice(0, 50)}...` })

    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      return { title: "P2P not initialized", output: "P2P not initialized", metadata: { totalPeers: 0, successful: 0, failed: 0 } } as any
    }

    const results = await P2PClient.broadcast({ task: params.task, context: params.context })
    const responses = results.map((r) => {
      const peer = P2PDiscovery.getPeer(r.peerId)
      return { peerId: r.peerId, peerName: peer?.name, success: !r.error, result: r.result, error: r.error }
    })

    const successful = responses.filter((r) => r.success)
    const failed = responses.filter((r) => !r.success)

    let output = `Broadcast results:\n\nTotal: ${results.length} | Successful: ${successful.length} | Failed: ${failed.length}\n\n`

    if (successful.length > 0) {
      output += `### Successful Responses\n\n`
      for (const r of successful) {
        output += `**${r.peerName || r.peerId}:**\n${r.result}\n\n`
      }
    }

    if (failed.length > 0) {
      output += `### Failed\n\n`
      for (const r of failed) {
        output += `- ${r.peerName || r.peerId}: ${r.error}\n`
      }
    }

    return {
      title: `Broadcast complete: ${successful.length}/${results.length} successful`,
      output,
      metadata: { totalPeers: results.length, successful: successful.length, failed: failed.length, responses },
    } as any
  },
})

/**
 * List Peers Tool
 */
export const ListPeersTool = Tool.define("list_peers", {
  description: "List all discovered Navi peers on the network. Returns information about each peer including their status, capabilities, and workspaces.",
  parameters: ListPeersParams,
  async execute(_params: z.infer<typeof ListPeersParams>, ctx) {
    const selfInfo = P2PDiscovery.getSelfInfo()
    const peers = P2PDiscovery.getPeers()
    ctx.metadata({ title: `Found ${peers.length} peer(s)` })

    let output = `P2P Peer List\n\nThis peer: ${selfInfo?.id || "unknown"}\n\n`

    if (peers.length === 0) {
      output += "No peers discovered."
    } else {
      output += `Discovered peers (${peers.length}):\n\n`
      for (const p of peers) {
        output += `### ${p.name}\n- ID: ${p.id}\n- Host: ${p.hostname}:${p.port}\n- Status: ${p.status || "unknown"}\n`
        if (p.capabilities?.length) output += `- Capabilities: ${p.capabilities.join(", ")}\n`
        if (p.workspaces?.length) output += `- Workspaces: ${p.workspaces.join(", ")}\n`
        output += "\n"
      }
    }

    return {
      title: `${peers.length} peer(s) discovered`,
      output,
      metadata: {
        selfId: selfInfo?.id || "unknown",
        peers: peers.map((p) => ({
          id: p.id, name: p.name, hostname: p.hostname, port: p.port,
          status: p.status || "unknown", capabilities: p.capabilities || [], workspaces: p.workspaces || [],
        })),
      },
    } as any
  },
})
