import { z } from "zod"
import { Tool } from "./tool"
import { P2PDiscovery, P2PClient } from "@/p2p"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool:check-peer" })

const CheckPeerStatusParams = z.object({
  peerId: z.string().optional().describe("Specific peer ID to check. If not provided, checks all peers."),
  includeDetails: z.boolean().optional().default(true).describe("Include detailed information about each peer"),
})

const PreFlightCheckParams = z.object({
  taskType: z.enum(["code", "analysis", "review", "general"]).optional()
    .describe("Type of task to check for (helps select appropriate peer)"),
})

/**
 * Check Peer Status Tool
 */
export const CheckPeerStatusTool = Tool.define("check_peer_status", {
  description: `Check if other Navi CLI instances (peers) are active and responding.

Use this tool to:
- Verify a peer is online before delegating tasks
- Check connectivity and latency to peers
- Get real-time status of all available peers
- Determine which peer is best suited for a task`,
  parameters: CheckPeerStatusParams,
  async execute(params: z.infer<typeof CheckPeerStatusParams>, ctx) {
    log.info("Checking peer status", { peerId: params.peerId })

    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      return {
        title: "P2P not initialized",
        output: "P2P not initialized. Start with 'navi peers start' to enable peer discovery.",
        metadata: { p2pEnabled: false },
      } as any
    }

    ctx.metadata({ title: "Checking peer status..." })

    const peersToCheck = params.peerId
      ? [P2PDiscovery.getPeer(params.peerId)].filter(Boolean)
      : P2PDiscovery.getPeers()

    if (peersToCheck.length === 0) {
      return {
        title: "No peers to check",
        output: params.peerId
          ? `Peer '${params.peerId}' not found in discovered peers.`
          : "No peers discovered. Ensure other Navi instances are running with P2P enabled.",
        metadata: { p2pEnabled: true, peerCount: 0, checkedPeers: [] },
      } as any
    }

    const results: Array<{
      peerId: string
      peerName: string
      status: "online" | "offline" | "error"
      latency?: number
      error?: string
      capabilities?: string[]
      workspaces?: string[]
    }> = []

    for (const peer of peersToCheck) {
      if (!peer) continue

      try {
        const latency = await P2PClient.ping(peer)
        results.push({
          peerId: peer.id,
          peerName: peer.name,
          status: "online",
          latency,
          capabilities: peer.capabilities,
          workspaces: peer.workspaces,
        })
      } catch (error) {
        results.push({
          peerId: peer.id,
          peerName: peer.name,
          status: "offline",
          error: error instanceof Error ? error.message : String(error),
          capabilities: peer.capabilities,
          workspaces: peer.workspaces,
        })
      }
    }

    const online = results.filter((r) => r.status === "online")
    const offline = results.filter((r) => r.status === "offline")

    let output = `Peer Status Check\n\nChecked: ${results.length} | Online: ${online.length} | Offline: ${offline.length}\n\n`

    if (online.length > 0) {
      output += `### Active Peers\n\n`
      for (const r of online) {
        output += `**${r.peerName}** (${r.peerId})\n- Status: ✅ Online\n- Latency: ${r.latency}ms\n`
        if (params.includeDetails && r.capabilities?.length) {
          output += `- Capabilities: ${r.capabilities.join(", ")}\n`
        }
        output += "\n"
      }
    }

    if (offline.length > 0) {
      output += `### Inactive Peers\n\n`
      for (const r of offline) {
        output += `**${r.peerName}** (${r.peerId})\n- Status: ❌ Offline\n`
        if (r.error) output += `- Error: ${r.error}\n`
        output += "\n"
      }
    }

    if (online.length > 0) {
      const fastest = online.reduce((a, b) => (a.latency || Infinity) < (b.latency || Infinity) ? a : b)
      output += `**Fastest peer:** ${fastest.peerName} (${fastest.latency}ms)`
    }

    return {
      title: `Peer Status: ${online.length}/${results.length} online`,
      output,
      metadata: {
        p2pEnabled: true,
        totalPeers: results.length,
        onlinePeers: online.length,
        offlinePeers: offline.length,
        checkedPeers: results,
        fastestPeer: online.length > 0 ? {
          peerId: online.reduce((a, b) => (a.latency || Infinity) < (b.latency || Infinity) ? a : b).peerId,
          latency: online.reduce((a, b) => (a.latency || Infinity) < (b.latency || Infinity) ? a : b).latency,
        } : null,
      },
    } as any
  },
})

/**
 * Pre-flight Check Tool
 */
export const PreFlightCheckTool = Tool.define("preflight_peer_check", {
  description: `Perform a pre-flight check before delegating tasks to peers.

This tool quickly checks if peers are available and returns a simple yes/no 
for whether delegation is possible.`,
  parameters: PreFlightCheckParams,
  async execute(params: z.infer<typeof PreFlightCheckParams>, ctx) {
    log.info("Pre-flight check", { taskType: params.taskType })

    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      return {
        title: "P2P not available",
        output: "P2P is not initialized. Task delegation is not available.",
        metadata: { canDelegate: false, reason: "p2p_not_initialized" },
      } as any
    }

    ctx.metadata({ title: "Pre-flight check..." })

    const peers = P2PDiscovery.getPeers()

    if (peers.length === 0) {
      return {
        title: "No peers available",
        output: "No peers discovered. Cannot delegate tasks.",
        metadata: { canDelegate: false, reason: "no_peers" },
      } as any
    }

    const availablePeers: Array<{ peerId: string; latency: number }> = []

    for (const peer of peers) {
      try {
        const latency = await P2PClient.ping(peer)
        availablePeers.push({ peerId: peer.id, latency })
      } catch { /* skip */ }
    }

    if (availablePeers.length === 0) {
      return {
        title: "No active peers",
        output: `${peers.length} peer(s) discovered but none are responding. Cannot delegate tasks.`,
        metadata: { canDelegate: false, reason: "no_active_peers", discoveredPeers: peers.length },
      } as any
    }

    const bestPeer = availablePeers.reduce((a, b) => a.latency < b.latency ? a : b)
    const peer = P2PDiscovery.getPeer(bestPeer.peerId)

    const output = `Pre-flight Check: ✅ Ready\n\nActive peers: ${availablePeers.length}\nBest peer: ${peer?.name || bestPeer.peerId} (${bestPeer.latency}ms)\n\nTask delegation is available.`

    return {
      title: "Ready to delegate",
      output,
      metadata: {
        canDelegate: true,
        activePeers: availablePeers.length,
        bestPeer: {
          peerId: bestPeer.peerId,
          peerName: peer?.name,
          latency: bestPeer.latency,
          capabilities: peer?.capabilities,
        },
      },
    } as any
  },
})


