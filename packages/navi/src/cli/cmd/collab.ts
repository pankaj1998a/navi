import { cmd } from "./cmd"
import { UI } from "../ui"
import { P2PDiscovery, P2PClient, P2PServer, type PeerInfo } from "@/p2p"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "cli:collab" })

/**
 * Collaboration Command
 * 
 * Manage collaborative sessions with other Navi peers.
 * 
 * @example
 * navi collab start              - Start a new collaborative session
 * navi collab invite <peer-id>   - Invite a peer to current session
 * navi collab join <session-id>  - Join a collaborative session
 * navi collab leave              - Leave current collaborative session
 * navi collab list               - List active collaborative sessions
 * navi collab status             - Show current collaboration status
 */
export const CollabCommand = cmd({
  command: "collab",
  describe: "manage collaborative sessions with peers",
  builder: (yargs) =>
    yargs
      .command(
        "start",
        "start a new collaborative session",
        (yargs) =>
          yargs
            .option("name", {
              alias: "n",
              describe: "Session name",
              type: "string",
            })
            .option("invite", {
              alias: "i",
              describe: "Peer IDs to invite (comma-separated)",
              type: "string",
            }),
        async (args) => {
          await startCollab(args.name, args.invite)
        }
      )
      .command(
        "invite <peer-id>",
        "invite a peer to the current collaborative session",
        (yargs) =>
          yargs.positional("peer-id", {
            describe: "Peer ID to invite",
            type: "string",
            demandOption: true,
          }),
        async (args) => {
          await invitePeer(args["peer-id"])
        }
      )
      .command(
        "join <peer-id> [session-id]",
        "join a collaborative session hosted by a peer",
        (yargs) =>
          yargs
            .positional("peer-id", {
              describe: "Peer ID hosting the session",
              type: "string",
              demandOption: true,
            })
            .positional("session-id", {
              describe: "Session ID to join (optional if peer has one active session)",
              type: "string",
            }),
        async (args) => {
          await joinCollab(args["peer-id"], args["session-id"])
        }
      )
      .command(
        "leave",
        "leave the current collaborative session",
        (yargs) => yargs,
        async () => {
          await leaveCollab()
        }
      )
      .command(
        "list",
        "list active collaborative sessions",
        (yargs) => yargs,
        async () => {
          await listCollabSessions()
        }
      )
      .command(
        "status",
        "show current collaboration status",
        (yargs) => yargs,
        async () => {
          await showCollabStatus()
        }
      )
      .command(
        "edit <file>",
        "share an edit with collaborative session participants",
        (yargs) =>
          yargs
            .positional("file", {
              describe: "File path",
              type: "string",
              demandOption: true,
            })
            .option("message", {
              alias: "m",
              describe: "Edit message",
              type: "string",
            }),
        async (args) => {
          await shareEdit(args.file, args.message)
        }
      )
      .demandCommand(1, "Please specify a command")
      .help(),
  handler: () => {},
})

// Current collaboration state
let currentSession: {
  id: string
  isHost: boolean
  host?: string
  participants: string[]
} | null = null

/**
 * Start a new collaborative session
 */
async function startCollab(name?: string, invitePeers?: string): Promise<void> {
  if (currentSession) {
    UI.error("Already in a collaborative session. Leave first with 'navi collab leave'")
    return
  }

  const selfInfo = P2PDiscovery.getSelfInfo()
  if (!selfInfo) {
    UI.error("P2P not initialized. Run 'navi peers start' first.")
    return
  }

  const projectPath = Instance.directory

  try {
    const session = P2PServer.createCollabSession(projectPath)
    
    currentSession = {
      id: session.id,
      isHost: true,
      participants: Array.from(session.participants),
    }

    UI.empty()
    UI.println(UI.Style.TEXT_SUCCESS + "✓ Collaborative session started")
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Session ID: " + UI.Style.RESET + session.id)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Project:    " + UI.Style.RESET + projectPath)
    UI.empty()

    // Invite peers if specified
    if (invitePeers) {
      const peerIds = invitePeers.split(",").map((s) => s.trim())
      for (const peerId of peerIds) {
        await invitePeerInternal(peerId, session.id, projectPath)
      }
    }
  } catch (error) {
    UI.error(`Failed to start session: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Invite a peer to the current session
 */
async function invitePeer(peerId: string): Promise<void> {
  if (!currentSession) {
    UI.error("Not in a collaborative session. Start one first with 'navi collab start'")
    return
  }

  if (!currentSession.isHost) {
    UI.error("Only the session host can invite peers")
    return
  }

  const projectPath = Instance.directory
  await invitePeerInternal(peerId, currentSession.id, projectPath)
}

/**
 * Internal function to invite a peer
 */
async function invitePeerInternal(
  peerId: string, 
  sessionID: string, 
  projectPath: string
): Promise<void> {
  const peer = P2PDiscovery.getPeer(peerId)

  if (!peer) {
    UI.error(`Peer not found: ${peerId}`)
    return
  }

  try {
    await P2PClient.inviteToCollab({
      peer,
      sessionID,
      projectPath,
    })

    UI.println(UI.Style.TEXT_SUCCESS + `✓ Invited ${peer.name} to session`)
  } catch (error) {
    UI.error(`Failed to invite ${peer.name}: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Join a collaborative session
 */
async function joinCollab(peerId: string, sessionID?: string): Promise<void> {
  if (currentSession) {
    UI.error("Already in a collaborative session. Leave first with 'navi collab leave'")
    return
  }

  const peer = P2PDiscovery.getPeer(peerId)

  if (!peer) {
    UI.error(`Peer not found: ${peerId}`)
    return
  }

  UI.println(`Joining session on ${peer.name}...`)

  try {
    // If no session ID provided, fetch available sessions from peer
    let targetSessionID = sessionID
    
    if (!targetSessionID) {
      // TODO: Fetch sessions from peer via API
      UI.error("No session ID provided and auto-discovery not implemented")
      UI.println(UI.Style.TEXT_DIM + "Usage: navi collab join <peer-id> <session-id>")
      return
    }

    await P2PClient.joinCollab({
      peer,
      sessionID: targetSessionID,
    })

    currentSession = {
      id: targetSessionID,
      isHost: false,
      host: peerId,
      participants: [],
    }

    UI.println(UI.Style.TEXT_SUCCESS + `✓ Joined session on ${peer.name}`)
    
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Session ID: " + UI.Style.RESET + targetSessionID)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Host:       " + UI.Style.RESET + peer.name)
    UI.empty()
  } catch (error) {
    UI.error("Failed to join session: " + (error instanceof Error ? error.message : String(error)))
  }
}

/**
 * Leave the current collaborative session
 */
async function leaveCollab(): Promise<void> {
  if (!currentSession) {
    UI.error("Not in a collaborative session")
    return
  }

  try {
    if (!currentSession.isHost && currentSession.host) {
      // Notify the host we're leaving
      const host = P2PDiscovery.getPeer(currentSession.host)
      if (host) {
        await P2PClient.leaveCollab({
          peer: host,
          sessionID: currentSession.id,
        })
      }
    }

    UI.println(UI.Style.TEXT_SUCCESS + "✓ Left collaborative session")
    currentSession = null
  } catch (error) {
    UI.error(`Failed to leave session: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * List active collaborative sessions
 */
async function listCollabSessions(): Promise<void> {
  const sessions = P2PServer.getCollabSessions()
  const selfInfo = P2PDiscovery.getSelfInfo()

  if (sessions.length === 0) {
    UI.println(UI.Style.TEXT_WARNING + "No active collaborative sessions")
    return
  }

  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + `Active Sessions (${sessions.length})`)
  UI.println(UI.Style.TEXT_DIM + "─".repeat(50))

  for (const session of sessions) {
    const isCurrent = currentSession?.id === session.id
    
    UI.println(
      (isCurrent ? UI.Style.TEXT_SUCCESS + "* " : "  ") + 
      UI.Style.TEXT_NORMAL_BOLD + session.id + 
      UI.Style.RESET
    )
    UI.println(UI.Style.TEXT_DIM + `   Host: ${session.host}`)
    UI.println(UI.Style.TEXT_DIM + `   Project: ${session.projectPath}`)
    UI.println(UI.Style.TEXT_DIM + `   Participants: ${session.participants.size}`)
    UI.empty()
  }
}

/**
 * Show current collaboration status
 */
async function showCollabStatus(): Promise<void> {
  if (!currentSession) {
    UI.println(UI.Style.TEXT_WARNING + "Not in a collaborative session")
    UI.println(UI.Style.TEXT_DIM + "Start one with 'navi collab start' or join with 'navi collab join'")
    return
  }

  const selfInfo = P2PDiscovery.getSelfInfo()
  
  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + "Collaboration Status")
  UI.println(UI.Style.TEXT_DIM + "─".repeat(40))
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Session ID:   " + UI.Style.RESET + currentSession.id)
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Role:         " + UI.Style.RESET + (currentSession.isHost ? "Host" : "Participant"))
  
  if (!currentSession.isHost && currentSession.host) {
    const host = P2PDiscovery.getPeer(currentSession.host)
    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Host:         " + UI.Style.RESET + (host?.name || currentSession.host))
  }
  
  UI.println(UI.Style.TEXT_NORMAL_BOLD + "Participants: " + UI.Style.RESET + currentSession.participants.length.toString())
  UI.empty()
}

/**
 * Share an edit with collaborative session participants
 */
async function shareEdit(file: string, message?: string): Promise<void> {
  if (!currentSession) {
    UI.error("Not in a collaborative session")
    return
  }

  if (!currentSession.isHost) {
    UI.error("Only the host can share edits currently")
    return
  }

  try {
    const content = await Bun.file(file).text()
    const lines = content.split("\n")

    // Simple whole-file edit for now
    const changes = [{
      startLine: 0,
      endLine: lines.length,
      newText: content,
    }]

    // Send to all participants
    const sessions = P2PServer.getCollabSessions()
    const session = sessions.find((s) => s.id === currentSession!.id)

    if (session) {
      for (const participantId of session.participants) {
        if (participantId === P2PDiscovery.getSelfInfo()?.id) continue
        
        const peer = P2PDiscovery.getPeer(participantId)
        if (peer) {
          await P2PClient.sendEdit({
            peer,
            sessionID: currentSession!.id,
            file,
            changes,
          })
        }
      }
    }

    UI.println(UI.Style.TEXT_SUCCESS + `✓ Shared edit: ${file}`)
    if (message) {
      UI.println(UI.Style.TEXT_DIM + `  ${message}`)
    }
  } catch (error) {
    UI.error(`Failed to share edit: ${error instanceof Error ? error.message : error}`)
  }
}



