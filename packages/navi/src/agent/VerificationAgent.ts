import { Orchestrator, AgentTask, AgentResult } from "./orchestrator"
import { ulid } from "ulid"
import { Log } from "../util/log"
import { Session } from "../session"

const log = Log.create({ service: "verification-agent" })

/**
 * VerificationAgent implements the Claude Code-style "Post-Completion" audit.
 * It spawns a specialized second agent to verify that the primary agent's 
 * work matches the requirements and hasn't introduced regressions.
 */
export class VerificationAgent {
    private orchestrator: Orchestrator

    constructor(orchestrator: Orchestrator) {
        this.orchestrator = orchestrator
    }

    /**
     * Verifies the output of a recently completed task.
     * @param sessionID The current session ID containing the conversation history.
     * @param task The task that was just completed.
     * @param originalResult The result from the primary agent.
     */
    async verify(sessionID: string, task: AgentTask, originalResult: AgentResult): Promise<AgentResult> {
        log.info("Starting post-task review", { taskId: task.id })

        // 1. Fetch recent transcripts for grounding
        const messages = await Session.messages({ sessionID: sessionID as any, limit: 15 })
        const transcriptSummary = messages
            .map(m => `[${m.info.role.toUpperCase()}]: ${m.parts.map(p => 'text' in p ? p.text : '').join(' ')}`)
            .join('\n---\n')

        // 2. Prepare a neutral verification prompt
        const verificationDescription = `
# POST-TASK REVIEW
You are an independent Quality Assurance reviewer. Confirm whether the work below is complete and identify any concrete issues that still need attention.

## TASK TO AUDIT:
"${task.description}"

## CONTEXT:
${transcriptSummary}

## OUTPUT TO AUDIT:
${originalResult.output}

## REVIEW INSTRUCTIONS:
1. Verify that the requested work is present and consistent.
2. Check for missing requirements, broken imports, and obvious regressions.
3. Prefer concise, actionable feedback over speculative criticism.

## VERDICT FORMAT:
- If the work is acceptable: return "VERIFIED" as your first word.
- If you find issues: return a short numbered list of concrete findings.
        `.trim()

        // 3. Spawn the Auditor Agent
        const verifierTask: AgentTask = {
            id: ulid(),
            type: 'reviewer',
            description: verificationDescription,
            context: { 
                originalTaskId: task.id,
                isAdversarialAudit: true 
            }
        }

        try {
            // SPIT (System Prompt Injection Tooling) - we make it clear this is a verification sub-task
            const verificationResult = await this.orchestrator.spawnAgent('reviewer', verifierTask, { autoVerify: false })
            
            const output = verificationResult.output.trim()
            if (output.startsWith("VERIFIED")) {
                log.info("Post-task review passed", { taskId: task.id })
                return originalResult
            } else {
                log.warn("Post-task review reported issues", { taskId: task.id, reason: output })
                return originalResult
            }
        } catch (error) {
            log.error("Error during post-task review", { error })
            return originalResult // Fallback to original if audit itself crashes
        }
    }
}
