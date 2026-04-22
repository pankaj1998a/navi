/**
 * Agent Checkpoint System
 * 
 * Provides periodic state snapshots for long-running agent tasks,
 * enabling crash recovery and continuous operation.
 */

import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Identifier } from "../id/id"
import { Instance } from "../project/instance"

const log = Log.create({ service: "agent-checkpoint" })

export namespace AgentCheckpoint {
    export interface Checkpoint {
        id: string
        sessionID: string
        projectID: string
        taskDescription: string
        agent: string
        progress: number          // 0-1, progress estimate
        state: Record<string, any>
        pendingActions: string[]
        createdAt: number
    }

    /**
     * Create a new checkpoint for a session
     */
    export async function save(input: {
        sessionID: string
        taskDescription: string
        agent: string
        progress?: number
        state: Record<string, any>
        pendingActions?: string[]
    }): Promise<Checkpoint> {
        const id = Identifier.ascending("checkpoint")
        const projectID = Instance.project.id

        const checkpoint: Checkpoint = {
            id,
            sessionID: input.sessionID,
            projectID,
            taskDescription: input.taskDescription,
            agent: input.agent,
            progress: input.progress ?? 0,
            state: input.state,
            pendingActions: input.pendingActions ?? [],
            createdAt: Date.now(),
        }

        await Storage.write(["checkpoint", projectID, id], checkpoint)

        // Also update a "latest" pointer for the session
        await Storage.write(["checkpoint_latest", input.sessionID], {
            id,
            createdAt: checkpoint.createdAt
        })

        log.info("saved checkpoint", { id, sessionID: input.sessionID, agent: input.agent })
        return checkpoint
    }

    /**
     * Restore the latest checkpoint for a session
     */
    export async function restoreLatest(sessionID: string): Promise<Checkpoint | null> {
        try {
            const latest = await Storage.read<{ id: string }>(["checkpoint_latest", sessionID])
            return await restore(latest.id)
        } catch {
            return null
        }
    }

    /**
     * Restore a specific checkpoint by ID
     */
    export async function restore(id: string): Promise<Checkpoint | null> {
        const projectID = Instance.project.id
        try {
            return await Storage.read<Checkpoint>(["checkpoint", projectID, id])
        } catch (e) {
            log.error("failed to restore checkpoint", { id, error: e })
            return null
        }
    }

    /**
     * List all checkpoints for the current project
     */
    export async function list(): Promise<Checkpoint[]> {
        const projectID = Instance.project.id
        const keys = await Storage.list(["checkpoint", projectID])
        const checkpoints: Checkpoint[] = []

        for (const key of keys) {
            try {
                const cp = await Storage.read<Checkpoint>(key)
                checkpoints.push(cp)
            } catch (e) {
                log.error("failed to read individual checkpoint during list", { key, error: e })
            }
        }

        return checkpoints.sort((a, b) => b.createdAt - a.createdAt)
    }

    /**
     * Delete old checkpoints for a session, keeping only the N most recent
     */
    export async function cleanup(sessionID: string, keepCount: number = 5): Promise<number> {
        const projectID = Instance.project.id
        try {
            const all = await list()
            const sessionCPs = all
                .filter(cp => cp.sessionID === sessionID)
                .sort((a, b) => b.createdAt - a.createdAt)

            if (sessionCPs.length <= keepCount) return 0

            const toDelete = sessionCPs.slice(keepCount)
            for (const cp of toDelete) {
                await Storage.remove(["checkpoint", projectID, cp.id])
            }

            log.info("cleaned up checkpoints", { sessionID, count: toDelete.length })
            return toDelete.length
        } catch (e) {
            log.error("checkpoint cleanup failed", { sessionID, error: e })
            return 0
        }
    }
}


