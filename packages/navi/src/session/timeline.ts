import { Log } from "../util/log"
import { v4 as uuid } from "uuid"
import { Storage } from "../storage/storage"
import { MessageV2 } from "./message-v2"

const log = Log.create({ service: "timeline" })

export interface TimelineNode {
    id: string
    sessionId: string
    messageId: string
    timestamp: number
    type: 'user' | 'assistant' | 'system' | 'branch' | 'merge'
    content: string
    summary?: string
    parentId: string | null
    branchId: string | null
    children: string[]
    metadata?: Record<string, unknown>
}

export interface TimelineBranch {
    id: string
    name: string
    createdAt: number
    createdFromNode: string
    color: string
    isActive: boolean
}

export interface TimelineSnapshot {
    nodes: Map<string, TimelineNode>
    branches: Map<string, TimelineBranch>
    rootNodes: string[]
    activeBranch: string
}

export interface TimelineOptions {
    maxNodes?: number
    maxDepth?: number
    includeMetadata?: boolean
}

export class TimelineManager {
    private snapshots: Map<string, TimelineSnapshot> = new Map()
    private storage: typeof Storage
    private options: TimelineOptions
    private colors: string[] = [
        '#89b4fa', // Blue
        '#a6e3a1', // Green
        '#f9e2af', // Yellow
        '#f38ba8', // Red
        '#cba6f7', // Purple
        '#fab387', // Orange
        '#94e2d5', // Cyan
        '#f5c2e7', // Pink
    ]

    constructor(options: TimelineOptions = {}) {
        this.options = {
            maxNodes: options.maxNodes ?? 1000,
            maxDepth: options.maxDepth ?? 50,
            includeMetadata: options.includeMetadata ?? false,
        }
        this.storage = Storage
    }

    async createTimeline(sessionId: string): Promise<TimelineSnapshot> {
        log.info("Creating timeline", { sessionId })

        const snapshot: TimelineSnapshot = {
            nodes: new Map(),
            branches: new Map(),
            rootNodes: [],
            activeBranch: 'main',
        }

        // Load messages from session
        const messages = await this.loadMessages(sessionId)

        // Build timeline from messages
        await this.buildTimeline(snapshot, messages)

        // Create main branch if none exists
        if (snapshot.branches.size === 0) {
            const mainBranch: TimelineBranch = {
                id: 'main',
                name: 'main',
                createdAt: Date.now(),
                createdFromNode: snapshot.rootNodes[0] || '',
                color: this.colors[0],
                isActive: true,
            }
            snapshot.branches.set('main', mainBranch)
        }

        this.snapshots.set(sessionId, snapshot)

        log.info("Timeline created", {
            sessionId,
            nodeCount: snapshot.nodes.size,
            branchCount: snapshot.branches.size
        })

        return snapshot
    }

    private async loadMessages(sessionId: string): Promise<MessageV2.WithParts[]> {
        const messages: MessageV2.WithParts[] = []

        for await (const msg of MessageV2.stream(sessionId)) {
            messages.push(msg)
        }

        // Reverse to get chronological order
        return messages.reverse()
    }

    private async buildTimeline(
        snapshot: TimelineSnapshot,
        messages: MessageV2.WithParts[]
    ): Promise<void> {
        let previousNode: string | null = null
        let depth = 0

        for (const message of messages) {
            if (depth >= this.options.maxDepth!) break

            const content = this.extractMessageContent(message)
            const summary = await this.generateSummary(content)

            const node: TimelineNode = {
                id: uuid(),
                sessionId: message.info.sessionID,
                messageId: message.info.id,
                timestamp: message.info.time.created || Date.now(),
                type: this.getMessageType(message),
                content: content.substring(0, 500), // Truncate for timeline
                summary,
                parentId: previousNode,
                branchId: snapshot.activeBranch,
                children: [],
                metadata: this.options.includeMetadata ? {
                    role: message.info.role,
                    model: (message.info as any).model,
                    tokens: (message.info as any).tokens,
                } : undefined,
            }

            snapshot.nodes.set(node.id, node)

            if (previousNode) {
                const parent = snapshot.nodes.get(previousNode)
                if (parent) {
                    parent.children.push(node.id)
                }
            } else {
                snapshot.rootNodes.push(node.id)
            }

            previousNode = node.id
            depth++
        }
    }

    private extractMessageContent(message: MessageV2.WithParts): string {
        const parts = message.parts || []
        return parts
            .map(part => {
                if ('text' in part && part.text) return part.text
                if ('reasoning' in part && part.reasoning) return `[Reasoning] ${part.reasoning}`
                return ''
            })
            .filter(Boolean)
            .join('\n')
    }

    private getMessageType(message: MessageV2.WithParts): TimelineNode['type'] {
        const role = message.info.role

        if (role === 'user') return 'user'
        if (role === 'assistant') return 'assistant'
        return 'assistant'
    }

    private async generateSummary(content: string): Promise<string> {
        // Simple summary - extract first sentence or first 100 chars
        const firstSentence = content.split(/[.!?]/)[0]
        if (firstSentence && firstSentence.length < 100) {
            return firstSentence.trim()
        }
        return content.substring(0, 100).trim()
    }

    async addNode(
        sessionId: string,
        message: MessageV2.WithParts,
        parentId: string | null = null
    ): Promise<TimelineNode> {
        const snapshot = this.snapshots.get(sessionId)
        if (!snapshot) {
            throw new Error(`Timeline not found for session: ${sessionId}`)
        }

        const content = this.extractMessageContent(message)
        const summary = await this.generateSummary(content)

        const node: TimelineNode = {
            id: uuid(),
            sessionId,
            messageId: message.info.id,
            timestamp: Date.now(),
            type: this.getMessageType(message),
            content,
            summary,
            parentId,
            branchId: snapshot.activeBranch,
            children: [],
            metadata: this.options.includeMetadata ? {
                role: message.info.role,
            } : undefined,
        }

        snapshot.nodes.set(node.id, node)

        if (parentId) {
            const parent = snapshot.nodes.get(parentId)
            if (parent) {
                parent.children.push(node.id)
            }
        } else {
            snapshot.rootNodes.push(node.id)
        }

        // Prune old nodes if needed
        if (snapshot.nodes.size > this.options.maxNodes!) {
            await this.pruneOldNodes(snapshot)
        }

        log.debug("Added timeline node", { nodeId: node.id, sessionId })
        return node
    }

    async createBranch(
        sessionId: string,
        fromNodeId: string,
        name: string
    ): Promise<TimelineBranch> {
        const snapshot = this.snapshots.get(sessionId)
        if (!snapshot) {
            throw new Error(`Timeline not found for session: ${sessionId}`)
        }

        const colorIndex = snapshot.branches.size % this.colors.length
        const branch: TimelineBranch = {
            id: uuid(),
            name,
            createdAt: Date.now(),
            createdFromNode: fromNodeId,
            color: this.colors[colorIndex],
            isActive: true,
        }

        // Deactivate other branches
        for (const [, b] of snapshot.branches) {
            b.isActive = false
        }

        snapshot.branches.set(branch.id, branch)
        snapshot.activeBranch = branch.id

        log.info("Created timeline branch", { branchId: branch.id, sessionId, name })
        return branch
    }

    async mergeBranch(
        sessionId: string,
        fromBranchId: string,
        toBranchId: string = 'main'
    ): Promise<void> {
        const snapshot = this.snapshots.get(sessionId)
        if (!snapshot) {
            throw new Error(`Timeline not found for session: ${sessionId}`)
        }

        const fromBranch = snapshot.branches.get(fromBranchId)
        const toBranch = snapshot.branches.get(toBranchId)

        if (!fromBranch || !toBranch) {
            throw new Error(`Branch not found`)
        }

        // Create merge node
        const mergeNode: TimelineNode = {
            id: uuid(),
            sessionId,
            messageId: uuid(),
            timestamp: Date.now(),
            type: 'merge',
            content: `Merged branch '${fromBranch.name}' into '${toBranch.name}'`,
            parentId: null,
            branchId: toBranchId,
            children: [],
            metadata: {
                mergedFrom: fromBranchId,
                mergedInto: toBranchId,
            },
        }

        snapshot.nodes.set(mergeNode.id, mergeNode)

        // Remove the merged branch
        snapshot.branches.delete(fromBranchId)

        // Activate target branch
        toBranch.isActive = true
        snapshot.activeBranch = toBranchId

        log.info("Merged timeline branch", {
            sessionId,
            fromBranch: fromBranch.name,
            toBranch: toBranch.name
        })
    }

    async switchBranch(sessionId: string, branchId: string): Promise<void> {
        const snapshot = this.snapshots.get(sessionId)
        if (!snapshot) {
            throw new Error(`Timeline not found for session: ${sessionId}`)
        }

        const branch = snapshot.branches.get(branchId)
        if (!branch) {
            throw new Error(`Branch not found: ${branchId}`)
        }

        for (const [, b] of snapshot.branches) {
            b.isActive = b.id === branchId
        }

        snapshot.activeBranch = branchId

        log.debug("Switched to branch", { sessionId, branchId })
    }

    async getTimeline(sessionId: string): Promise<TimelineSnapshot | null> {
        return this.snapshots.get(sessionId) || null
    }

    async getActiveBranch(sessionId: string): Promise<TimelineBranch | null> {
        const snapshot = this.snapshots.get(sessionId)
        if (!snapshot) return null

        return snapshot.branches.get(snapshot.activeBranch) || null
    }

    async getBranches(sessionId: string): Promise<TimelineBranch[]> {
        const snapshot = this.snapshots.get(sessionId)
        if (!snapshot) return []

        return Array.from(snapshot.branches.values())
    }

    async getNodePath(sessionId: string, nodeId: string): Promise<TimelineNode[]> {
        const snapshot = this.snapshots.get(sessionId)
        if (!snapshot) return []

        const path: TimelineNode[] = []
        let current = snapshot.nodes.get(nodeId)

        while (current) {
            path.unshift(current)
            if (current.parentId) {
                current = snapshot.nodes.get(current.parentId)
            } else {
                break
            }
        }

        return path
    }

    async getDiff(
        sessionId: string,
        nodeId1: string,
        nodeId2: string
    ): Promise<{ added: string[]; removed: string[] }> {
        const path1 = await this.getNodePath(sessionId, nodeId1)
        const path2 = await this.getNodePath(sessionId, nodeId2)

        const set1 = new Set(path1.map(n => n.messageId))
        const set2 = new Set(path2.map(n => n.messageId))

        const added = path2.filter(n => !set1.has(n.messageId)).map(n => n.content)
        const removed = path1.filter(n => !set2.has(n.messageId)).map(n => n.content)

        return { added, removed }
    }

    private async pruneOldNodes(snapshot: TimelineSnapshot): Promise<void> {
        const nodes = Array.from(snapshot.nodes.values())

        // Sort by timestamp, keep most recent
        nodes.sort((a, b) => b.timestamp - a.timestamp)

        const toRemove = nodes.slice(this.options.maxNodes!)

        for (const node of toRemove) {
            snapshot.nodes.delete(node.id)

            // Remove from parent's children
            if (node.parentId) {
                const parent = snapshot.nodes.get(node.parentId)
                if (parent) {
                    parent.children = parent.children.filter(id => id !== node.id)
                }
            }

            // Remove from root nodes
            snapshot.rootNodes = snapshot.rootNodes.filter(id => id !== node.id)
        }

        log.debug("Pruned old timeline nodes", { count: toRemove.length })
    }

    async exportTimeline(sessionId: string): Promise<string> {
        const snapshot = this.snapshots.get(sessionId)
        if (!snapshot) {
            throw new Error(`Timeline not found for session: ${sessionId}`)
        }

        const exportData = {
            sessionId,
            exportedAt: new Date().toISOString(),
            branches: Array.from(snapshot.branches.values()),
            nodes: Array.from(snapshot.nodes.values()).map(n => ({
                ...n,
                children: n.children.slice(0, 10), // Limit children in export
            })),
            activeBranch: snapshot.activeBranch,
        }

        return JSON.stringify(exportData, null, 2)
    }

    async importTimeline(sessionId: string, data: string): Promise<TimelineSnapshot> {
        const importData = JSON.parse(data)

        const snapshot: TimelineSnapshot = {
            nodes: new Map(),
            branches: new Map(),
            rootNodes: [],
            activeBranch: importData.activeBranch,
        }

        for (const branch of importData.branches) {
            snapshot.branches.set(branch.id, branch)
        }

        for (const node of importData.nodes) {
            snapshot.nodes.set(node.id, node)
            if (!node.parentId) {
                snapshot.rootNodes.push(node.id)
            }
        }

        this.snapshots.set(sessionId, snapshot)

        log.info("Imported timeline", { sessionId })
        return snapshot
    }

    async dispose(sessionId: string): Promise<void> {
        const snapshot = this.snapshots.get(sessionId)
        if (snapshot) {
            snapshot.nodes.clear()
            snapshot.branches.clear()
            snapshot.rootNodes = []
            this.snapshots.delete(sessionId)
        }

        log.debug("Disposed timeline", { sessionId })
    }
}

export const Timeline = new TimelineManager()
