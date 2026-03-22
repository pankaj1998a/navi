import { cmd } from "./cmd"
import { UI } from "../ui"
import { P2PDiscovery, P2PClient, type PeerInfo } from "@/p2p"
import { Log } from "@/util/log"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { resolveNetworkOptions, withNetworkOptions } from "../network"
import { Server } from "@/server/server"
import { P2P } from "@/p2p"

const log = Log.create({ service: "cli:peers" })

/**
 * Peers Command
 * 
 * Manage Navi peer connections for terminal-to-terminal communication.
 * 
 * @example
 * navi peers list              - List discovered peers
 * navi peers show <peer-id>    - Show peer details
 * navi peers ping <peer-id>    - Ping a peer
 * navi peers ask <peer-id>     - Ask a peer for help
 * navi peers share <peer-id>   - Share files with a peer
 * navi peers start             - Start P2P discovery
 * navi peers stop              - Stop P2P discovery
 */
export const PeersCommand = cmd({
  command: "peers",
  describe: "manage navi peer connections",
  builder: (yargs) =>
    yargs
      .command(
        "list",
        "list discovered navi peers",
        (yargs) => yargs,
        async () => {
          await listPeers()
        }
      )
      .command(
        "show <peer-id>",
        "show details for a specific peer",
        (yargs) =>
          yargs.positional("peer-id", {
            describe: "Peer ID to show",
            type: "string",
            demandOption: true,
          }),
        async (args) => {
          await showPeer(args["peer-id"])
        }
      )
      .command(
        "ping <peer-id>",
        "ping a peer to check connectivity",
        (yargs) =>
          yargs.positional("peer-id", {
            describe: "Peer ID to ping",
            type: "string",
            demandOption: true,
          }),
        async (args) => {
          await pingPeer(args["peer-id"])
        }
      )
      .command(
        "ask <peer-id> <task>",
        "ask a peer for help with a task",
        (yargs) =>
          yargs
            .positional("peer-id", {
              describe: "Peer ID to ask",
              type: "string",
              demandOption: true,
            })
            .positional("task", {
              describe: "Task to ask for help with",
              type: "string",
              demandOption: true,
            })
            .option("context", {
              alias: "c",
              describe: "Additional context",
              type: "string",
            })
            .option("file", {
              alias: "f",
              describe: "Files to include (can be used multiple times)",
              type: "string",
              array: true,
              default: [],
            }),
        async (args) => {
          await askPeer(args["peer-id"], args.task, {
            context: args.context,
            files: args.file,
          })
        }
      )
      .command(
        "share <peer-id>",
        "share files with a peer",
        (yargs) =>
          yargs
            .positional("peer-id", {
              describe: "Peer ID to share with",
              type: "string",
              demandOption: true,
            })
            .option("file", {
              alias: "f",
              describe: "Files to share (can be used multiple times)",
              type: "string",
              array: true,
              demandOption: true,
            }),
        async (args) => {
          await shareWithPeer(args["peer-id"], args.file)
        }
      )
      .command(
        "broadcast <task>",
        "send a task to all available peers",
        (yargs) =>
          yargs
            .positional("task", {
              describe: "Task to broadcast",
              type: "string",
              demandOption: true,
            })
            .option("context", {
              alias: "c",
              describe: "Additional context",
              type: "string",
            }),
        async (args) => {
          await broadcastTask(args.task, args.context)
        }
      )
      .command(
        "start",
        "start P2P discovery",
        (yargs) => withNetworkOptions(yargs),
        async (args) => {
          await startP2P(args)
        }
      )
      .command(
        "stop",
        "stop P2P discovery",
        (yargs) => yargs,
        async () => {
          await stopP2P()
        }
      )
      .command(
        "info",
        "show this peer's info",
        (yargs) => yargs,
        async () => {
          await showSelfInfo()
        }
      )
      .demandCommand(1, "Please specify a command")
      .help(),
  handler: () => {},
})

/**
 * List all discovered peers
 */
async function listPeers(): Promise<void> {
  const peers = P2PDiscovery.getPeers()

  if (peers.length === 0) {
    UI.println(UI.Style.TEXT_WARNING + "No peers discovered.")
    UI.println(UI.Style.TEXT_DIM + "Run 'navi peers start' to start discovery.")
    return
  }

  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + `Discovered Peers (${peers.length})`)
  UI.println(UI.Style.TEXT_DIM + "─".repeat(60))

  for (const peer of peers) {
    const status = getStatusIcon(peer.status)
    const host = `${peer.hostname}:${peer.port}`
    
    UI.println(
      status + " " + UI.Style.TEXT_NORMAL_BOLD + peer.name + UI.Style.RESET,
      UI.Style.TEXT_DIM + ` (${peer.id})`,
    )
    UI.println(UI.Style.TEXT_DIM + `   Host: ${host}`)
    if (peer.version) {
      UI.println(UI.Style.TEXT_DIM + `   Version: ${peer.version}`)
    }
    if (peer.workspaces && peer.workspaces.length > 0) {
      UI.println(UI.Style.TEXT_DIM + `   Workspaces: ${peer.workspaces.join(", ")}`)
    }
    if (peer.capabilities && peer.capabilities.length > 0) {
      UI.println(UI.Style.TEXT_DIM + `   Capabilities: ${peer.capabilities.join(", ")}`)
    }
    UI.empty()
  }
}

/**
 * Show details for a specific peer
 */
async function showPeer(peerId: string): Promise<void> {
  const peer = P2PDiscovery.getPeer(peerId)

  if (!peer) {
    UI.error(`Peer not found: ${peerId}`)
    return
  }

  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + "Peer Details")
  UI.println(UI.Style.TEXT_DIM + "─".repeat(40))
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "ID:          " + UI.Style.RESET + peer.id)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Name:        " + UI.Style.RESET + peer.name)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Host:        " + UI.Style.RESET + `${peer.hostname}:${peer.port}`)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Status:      " + UI.Style.RESET + getStatusText(peer.status))
  if (peer.version) {
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Version:     " + UI.Style.RESET + peer.version)
  }
  if (peer.workspaces && peer.workspaces.length > 0) {
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Workspaces:  " + UI.Style.RESET + peer.workspaces.join(", "))
  }
  if (peer.capabilities && peer.capabilities.length > 0) {
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Capabilities:" + UI.Style.RESET + " " + peer.capabilities.join(", "))
  }
  if (peer.lastSeen) {
    const ago = formatTimeAgo(peer.lastSeen)
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Last Seen:   " + UI.Style.RESET + ago)
  }
  UI.empty()
}

/**
 * Ping a peer
 */
async function pingPeer(peerId: string): Promise<void> {
  const peer = P2PDiscovery.getPeer(peerId)

  if (!peer) {
    UI.error(`Peer not found: ${peerId}`)
    return
  }

  UI.println(`Pinging ${peer.name}...`)

  try {
    const latency = await P2PClient.ping(peer)
    UI.println(UI.Style.TEXT_SUCCESS + `✓ Response from ${peer.name}: ${latency}ms`)
  } catch (error) {
    UI.error(`Failed to ping ${peer.name}: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Ask a peer for help
 */
async function askPeer(
  peerId: string, 
  task: string, 
  options: { context?: string; files?: string[] }
): Promise<void> {
  const peer = P2PDiscovery.getPeer(peerId)

  if (!peer) {
    UI.error(`Peer not found: ${peerId}`)
    return
  }

  UI.println(`Asking ${peer.name} for help...`)
  UI.empty()

  // Read files if provided
  const files = options.files ? await readFiles(options.files) : undefined

  try {
    const response = await P2PClient.requestHelp({
      peer,
      task,
      context: options.context,
      files,
    })
    
    UI.println(UI.Style.TEXT_SUCCESS + "Response from " + peer.name + ":")
    UI.empty()
    UI.println(response.result)
  } catch (error) {
    UI.error(`Failed to get response: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Share files with a peer
 */
async function shareWithPeer(peerId: string, filePaths: string[]): Promise<void> {
  const peer = P2PDiscovery.getPeer(peerId)

  if (!peer) {
    UI.error(`Peer not found: ${peerId}`)
    return
  }

  UI.println(`Sharing ${filePaths.length} file(s) with ${peer.name}...`)

  try {
    const files = await readFiles(filePaths)
    
    await P2PClient.shareContext({
      peer,
      files,
    })

    UI.println(UI.Style.TEXT_SUCCESS + `✓ Shared ${files.length} file(s) with ${peer.name}`)
  } catch (error) {
    UI.error(`Failed to share files: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Broadcast a task to all available peers
 */
async function broadcastTask(task: string, context?: string): Promise<void> {
  const peers = P2PDiscovery.getPeers().filter((p) => p.status === "online")

  if (peers.length === 0) {
    UI.error("No online peers available")
    return
  }

  UI.println(`Broadcasting task to ${peers.length} peer(s)...`)
  UI.empty()

  try {
    const results = await P2PClient.broadcast({ task, context })

    for (const result of results) {
      const peer = P2PDiscovery.getPeer(result.peerId)
      const peerName = peer?.name || result.peerId

      if (result.error) {
        UI.println(UI.Style.TEXT_DANGER + `✗ ${peerName}: ${result.error}` + UI.Style.RESET)
      } else {
        UI.println(UI.Style.TEXT_SUCCESS + `✓ ${peerName}: ${result.result}` + UI.Style.RESET)
      }
    }
  } catch (error) {
    UI.error(`Broadcast failed: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Start P2P discovery
 */
async function startP2P(args: any): Promise<void> {
  UI.println("Starting P2P discovery...")

  const opts = await resolveNetworkOptions(args)
  const server = Server.listen(opts)

  // Initialize P2P with the server port
  P2P.init(server.port!)

  const selfInfo = P2PDiscovery.getSelfInfo()

  UI.empty()
  UI.println(UI.Style.TEXT_SUCCESS + "✓ P2P discovery started")
  UI.println(UI.Style.TEXT_INFO_BOLD + "  Peer ID:    " + UI.Style.RESET + selfInfo?.id)
  UI.println(UI.Style.TEXT_INFO_BOLD + "  Listening:  " + UI.Style.RESET + `http://${server.hostname}:${server.port}`)
  UI.empty()
  UI.println(UI.Style.TEXT_DIM + "Press Ctrl+C to stop")

  // Keep running
  await new Promise(() => {})
}

/**
 * Stop P2P discovery
 */
async function stopP2P(): Promise<void> {
  P2P.stop()
  UI.println(UI.Style.TEXT_SUCCESS + "✓ P2P discovery stopped")
}

/**
 * Show this peer's info
 */
async function showSelfInfo(): Promise<void> {
  const selfInfo = P2PDiscovery.getSelfInfo()

  if (!selfInfo) {
    UI.println(UI.Style.TEXT_WARNING + "P2P not initialized. Run 'navi peers start' first.")
    return
  }

  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + "This Peer")
  UI.println(UI.Style.TEXT_DIM + "─".repeat(40))
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "ID:          " + UI.Style.RESET + selfInfo.id)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Name:        " + UI.Style.RESET + selfInfo.name)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Host:        " + UI.Style.RESET + `${selfInfo.hostname}:${selfInfo.port}`)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Status:      " + UI.Style.RESET + getStatusText(selfInfo.status))
  if (selfInfo.version) {
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Version:     " + UI.Style.RESET + selfInfo.version)
  }
  if (selfInfo.workspaces && selfInfo.workspaces.length > 0) {
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Workspaces:  " + UI.Style.RESET + selfInfo.workspaces.join(", "))
  }
  if (selfInfo.capabilities && selfInfo.capabilities.length > 0) {
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Capabilities:" + UI.Style.RESET + " " + selfInfo.capabilities.join(", "))
  }
  UI.empty()
}

// Helper functions

function getStatusIcon(status?: string): string {
  switch (status) {
    case "online":
      return UI.Style.TEXT_SUCCESS + "●" + UI.Style.RESET
    case "busy":
      return UI.Style.TEXT_WARNING + "●" + UI.Style.RESET
    case "offline":
      return UI.Style.TEXT_DANGER + "○" + UI.Style.RESET
    default:
      return UI.Style.TEXT_DIM + "●" + UI.Style.RESET
  }
}

function getStatusText(status?: string): string {
  switch (status) {
    case "online":
      return UI.Style.TEXT_SUCCESS + "Online" + UI.Style.RESET
    case "busy":
      return UI.Style.TEXT_WARNING + "Busy" + UI.Style.RESET
    case "offline":
      return UI.Style.TEXT_ERROR + "Offline" + UI.Style.RESET
    default:
      return UI.Style.TEXT_DIM + "Unknown" + UI.Style.RESET
  }
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

async function readFiles(paths: string[]): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = []
  
  for (const path of paths) {
    try {
      const content = await Bun.file(path).text()
      files.push({ path, content })
    } catch (error) {
      log.warn("Failed to read file", { path, error })
    }
  }
  
  return files
}
