import { Session } from "../session"
import { Agent } from "./agent"
import { Orchestrator, AgentTask } from "./orchestrator"
import { SessionCompactionMemory } from "../session/compaction-memory"
import { MemoryFacts } from "./memory-facts"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { ulid } from "ulid"

const log = Log.create({ service: "auto-dream" })

/**
 * AutoDreamService handles background memory consolidation.
 * Similar to Claude Code's "Dreaming", it periodically summarizes 
 * the conversation and extracts "Facts" into long-term storage.
 */
export class AutoDreamService {
    private static THRESHOLD = 20 // Number of messages before dreaming
    private static INTERVAL_MS = 60000 * 5 // Check every 5 minutes
    private timer?: Timer
    private orchestrator: Orchestrator

    constructor(orchestrator: Orchestrator) {
        this.orchestrator = orchestrator
    }

    start() {
        if (this.timer) return
        this.timer = setInterval(() => this.checkAndDream(), AutoDreamService.INTERVAL_MS)
        log.info("AutoDream service started")
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = undefined
        }
    }

    private async checkAndDream() {
        try {
            // 1. Get active session
            if (!Instance.project) return
            const projectID = Instance.project.id
            const activeSessions = await Array.fromAsync(Session.list())
            const mainSession = activeSessions.find(s => !s.time.archived)

            if (!mainSession) return

            // 2. Check message count
            const messages = await Session.messages({ sessionID: mainSession.id })
            if (messages.length < AutoDreamService.THRESHOLD) return

            log.info("Session threshold reached. Starting 'Dream' consolidation...", { 
                sessionID: mainSession.id, 
                messageCount: messages.length 
            })

            // 3. Run compaction agent in background
            const compactionTask: AgentTask = {
                id: ulid(),
                type: 'orchestrator', // Using higher level to allow sub-calls if needed
                description: "Summarize the current session and extract all key decisions, objectives, and files discovered. Be exhaustive but concise."
            }

            // We use 'compaction' agent specifically
            const result = await this.orchestrator.spawnAgent('orchestrator', compactionTask, { 
                autoVerify: false,
                sessionID: mainSession.id 
            })

            if (result.success && result.output) {
                // 4. Parse and Store Facts
                const summary = SessionCompactionMemory.parse(result.output)
                if (SessionCompactionMemory.hasContent(summary)) {
                    await MemoryFacts.storeCompactionFacts({
                        summary,
                        source: {
                            type: "session-compaction",
                            sessionID: mainSession.id,
                            projectID: projectID
                        },
                        projectID: projectID
                    })
                    log.info("Dream completed. Facts consolidated to long-term memory.")
                }
            }

        } catch (error) {
            log.error("AutoDream failed", { error })
        }
    }
}


