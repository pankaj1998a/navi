import { z } from "zod"
import { Tool } from "./tool"
import { P2PDiscovery, P2PClient, type PeerInfo } from "@/p2p"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool:peer-messaging" })

// Define parameter schemas separately
const SendMessageParams = z.object({
  peerId: z.string().describe("ID of the peer to send message to"),
  message: z.string().describe("The message to send to the peer"),
  expectResponse: z.boolean().optional().default(true).describe("Wait for a response from the peer"),
  context: z.string().optional().describe("Additional context (files, code snippets, etc.)"),
})

const AskPeerParams = z.object({
  question: z.string().describe("The question to ask the peer"),
  peerId: z.string().optional().describe("Specific peer ID (if not provided, auto-selects best peer)"),
  context: z.string().optional().describe("Context for the question (code, files, etc.)"),
  files: z.array(z.object({
    path: z.string().describe("File path"),
    content: z.string().optional().describe("File content"),
  })).optional().describe("Files to share with the peer"),
})

const AssignTaskParams = z.object({
  task: z.string().describe("Clear description of the task to assign"),
  peerId: z.string().optional().describe("Specific peer ID (auto-selects if not provided)"),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium").describe("Task priority"),
  deadline: z.string().optional().describe("Optional deadline or time constraint"),
  files: z.array(z.object({
    path: z.string(),
    content: z.string().optional(),
  })).optional().describe("Files relevant to the task"),
  expectedOutput: z.string().optional().describe("What kind of output is expected"),
})

const CoordinateParams = z.object({
  mainTask: z.string().describe("The main task to coordinate"),
  divideStrategy: z.enum(["parallel", "sequential", "by_expertise"])
    .optional()
    .default("parallel")
    .describe("How to divide the work"),
  targetPeers: z.array(z.string()).optional()
    .describe("Specific peer IDs to use (uses all available if not specified)"),
  waitForAll: z.boolean().optional().default(true)
    .describe("Wait for all peers to complete before returning"),
})

/**
 * Send Message to Peer Tool
 */
export const SendMessageToPeerTool = Tool.define("send_message_to_peer", {
  description: `Send a direct message to another Navi terminal instance.

Use this for:
- Starting a conversation with another terminal
- Asking quick questions
- Sharing information or updates
- Coordinating work between terminals`,
  parameters: SendMessageParams,
  async execute(params: z.infer<typeof SendMessageParams>, ctx) {
    log.info("Sending message to peer", { peerId: params.peerId })

    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      return { title: "P2P not available", output: "P2P is not initialized. Start with 'navi peers start'.", metadata: { success: false } } as any
    }

    const peer = P2PDiscovery.getPeer(params.peerId)
    if (!peer) {
      return { title: "Peer not found", output: `Peer '${params.peerId}' not found. Use 'list_peers' to see available peers.`, metadata: { success: false, peerId: params.peerId } } as any
    }

    ctx.metadata({ title: `Sending message to ${peer.name}...` })

    try {
      const latency = await P2PClient.ping(peer)
      const response = await P2PClient.requestHelp({ peer, task: params.message, context: params.context })

      const output = `Message sent to **${peer.name}**\nLatency: ${latency}ms\n\n**Response:**\n${response.result}`

      return { title: `Response from ${peer.name}`, output, metadata: { success: true, peerId: peer.id, peerName: peer.name, latency, response: response.result } } as any
    } catch (error) {
      return { title: "Failed to send message", output: `Could not reach ${peer.name}: ${error instanceof Error ? error.message : String(error)}`, metadata: { success: false, peerId: peer.id, error: error instanceof Error ? error.message : String(error) } } as any
    }
  },
})

/**
 * Ask Peer Tool
 */
export const AskPeerTool = Tool.define("ask_peer", {
  description: `Ask another Navi instance a question and get their response.

Use this when you need:
- Another AI's perspective on a problem
- Code review from another terminal
- Help understanding complex code
- Second opinion on design decisions`,
  parameters: AskPeerParams,
  async execute(params: z.infer<typeof AskPeerParams>, ctx) {
    log.info("Asking peer", { question: params.question.slice(0, 50), peerId: params.peerId })

    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      return { title: "P2P not available", output: "P2P is not initialized. Start with 'navi peers start'.", metadata: { success: false } } as any
    }

    let peer: PeerInfo | undefined
    if (params.peerId) {
      peer = P2PDiscovery.getPeer(params.peerId)
      if (!peer) {
        return { title: "Peer not found", output: `Peer '${params.peerId}' not found.`, metadata: { success: false } } as any
      }
    } else {
      peer = P2PClient.getBestPeerForTask(params.question)
      if (!peer) {
        return { title: "No peers available", output: "No peers available. Use 'list_peers' to check peer status.", metadata: { success: false } } as any
      }
    }

    ctx.metadata({ title: `Asking ${peer.name}...` })

    let task = params.question
    if (params.context) {
      task = `Context:\n${params.context}\n\nQuestion:\n${params.question}`
    }

    try {
      const response = await P2PClient.requestHelp({ peer, task, files: params.files })
      const output = `**Asked ${peer.name}:**\n\n> ${params.question}\n\n**Response:**\n\n${response.result}`

      return { title: `Answer from ${peer.name}`, output, metadata: { success: true, peerId: peer.id, peerName: peer.name, question: params.question, response: response.result } } as any
    } catch (error) {
      return { title: "Failed to get response", output: `${peer.name} could not respond: ${error instanceof Error ? error.message : String(error)}`, metadata: { success: false, peerId: peer.id, error: error instanceof Error ? error.message : String(error) } } as any
    }
  },
})

/**
 * Assign Task to Peer Tool
 */
export const AssignTaskToPeerTool = Tool.define("assign_task_to_peer", {
  description: `Assign a specific task to another Navi terminal instance.

Use this when you want to:
- Delegate a complete task to another terminal
- Distribute work across multiple Navi instances
- Have another AI work on something independently`,
  parameters: AssignTaskParams,
  async execute(params: z.infer<typeof AssignTaskParams>, ctx) {
    log.info("Assigning task to peer", { task: params.task.slice(0, 50), peerId: params.peerId })

    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      return { title: "P2P not available", output: "P2P is not initialized. Start with 'navi peers start'.", metadata: { success: false } } as any
    }

    let peer: PeerInfo | undefined
    if (params.peerId) {
      peer = P2PDiscovery.getPeer(params.peerId)
    } else {
      peer = P2PClient.getBestPeerForTask(params.task)
    }

    if (!peer) {
      return { title: "No peer available", output: params.peerId ? `Peer '${params.peerId}' not found.` : "No peers available for task assignment.", metadata: { success: false } } as any
    }

    if (!peer.capabilities?.includes("accept-tasks")) {
      return { title: "Peer does not accept tasks", output: `${peer.name} is not configured to accept task assignments.`, metadata: { success: false, peerId: peer.id } } as any
    }

    ctx.metadata({ title: `Assigning task to ${peer.name}...` })

    let taskDescription = `**Task Assignment**\n\nPriority: ${params.priority}\n`
    if (params.deadline) taskDescription += `Deadline: ${params.deadline}\n`
    taskDescription += `\n**Task:**\n${params.task}\n`
    if (params.expectedOutput) taskDescription += `\n**Expected Output:**\n${params.expectedOutput}\n`

    try {
      const response = await P2PClient.requestHelp({ peer, task: taskDescription, files: params.files })
      const output = `**Task Assigned to ${peer.name}**\n\nTask: ${params.task}\nPriority: ${params.priority}\n${params.deadline ? `Deadline: ${params.deadline}\n` : ''}\n**Status:** Task accepted\n\n**Result:**\n${response.result}`

      return { title: `Task assigned to ${peer.name}`, output, metadata: { success: true, peerId: peer.id, peerName: peer.name, task: params.task, priority: params.priority, result: response.result, sessionID: (response as any).sessionID } } as any
    } catch (error) {
      return { title: "Task assignment failed", output: `${peer.name} could not accept task: ${error instanceof Error ? error.message : String(error)}`, metadata: { success: false, peerId: peer.id, error: error instanceof Error ? error.message : String(error) } } as any
    }
  },
})

/**
 * Coordinate with Peers Tool
 */
export const CoordinateWithPeersTool = Tool.define("coordinate_with_peers", {
  description: `Coordinate work among multiple Navi terminal instances.

Use this to:
- Distribute different parts of a task to different terminals
- Get multiple perspectives on the same problem
- Parallelize work across available peers`,
  parameters: CoordinateParams,
  async execute(params: z.infer<typeof CoordinateParams>, ctx) {
    log.info("Coordinating with peers", { mainTask: params.mainTask.slice(0, 50) })

    const selfInfo = P2PDiscovery.getSelfInfo()
    if (!selfInfo) {
      return { title: "P2P not available", output: "P2P is not initialized.", metadata: { success: false } } as any
    }

    const targetPeers = params.targetPeers
      ? params.targetPeers.map((id: string) => P2PDiscovery.getPeer(id)).filter(Boolean) as PeerInfo[]
      : P2PDiscovery.getPeers().filter((p) => p.capabilities?.includes("accept-tasks"))

    if (targetPeers.length === 0) {
      return { title: "No peers available", output: "No peers available for coordination.", metadata: { success: false } } as any
    }

    ctx.metadata({ title: `Coordinating ${targetPeers.length} peer(s)...` })

    const results = await P2PClient.broadcast({
      task: `**Coordinated Task**\n\nWork on this part of a larger task:\n\n${params.mainTask}\n\nCoordinate with other Navi instances if needed.`,
      context: `This is part of a coordinated effort by ${targetPeers.length} Navi instances.`,
    })

    const successful = results.filter((r) => !r.error)
    const failed = results.filter((r) => r.error)

    let output = `**Coordination Results**\n\nPeers coordinated: ${targetPeers.length}\nSuccessful responses: ${successful.length}\nFailed: ${failed.length}\n\n`

    if (successful.length > 0) {
      output += `### Results from Peers\n\n`
      for (const result of successful) {
        const peer = P2PDiscovery.getPeer(result.peerId)
        output += `#### ${peer?.name || result.peerId}\n${result.result}\n\n`
      }
    }

    if (failed.length > 0) {
      output += `### Failed Peers\n\n`
      for (const result of failed) {
        const peer = P2PDiscovery.getPeer(result.peerId)
        output += `- ${peer?.name || result.peerId}: ${result.error}\n`
      }
    }

    return {
      title: `Coordination complete: ${successful.length}/${targetPeers.length} responded`,
      output,
      metadata: { success: successful.length > 0, totalPeers: targetPeers.length, successfulCount: successful.length, failedCount: failed.length, results },
    } as any
  },
})


