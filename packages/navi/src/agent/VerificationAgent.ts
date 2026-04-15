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
        log.info("Starting adversarial post-task audit", { taskId: task.id })

        // 1. Fetch recent transcripts for grounding
        const messages = await Session.messages({ sessionID: sessionID as any, limit: 15 })
        const transcriptSummary = messages
            .map(m => `[${m.info.role.toUpperCase()}]: ${m.parts.map(p => 'text' in p ? p.text : '').join(' ')}`)
            .join('\n---\n')

        // 2. Prepare the ADVERSARIAL verification prompt
        const verificationDescription = `
# ADVERSARIAL AUDIT PROTOCOL (v4.0)
You are an independent, extremely skeptical Quality Assurance Auditor. Your goal is to find reasons to REJECT the work provided below.

## TASK TO AUDIT:
"${task.description}"

## CONTEXT:
${transcriptSummary}

## OUTPUT TO AUDIT:
${originalResult.output}

## AUDIT INSTRUCTIONS:
1. **Be Skeptical**: Assume the developer took shortcuts, hallucinated tool outputs, or ignored edge cases.
2. **Verify Truth**: If the developer claims a problem is solved, use your tools (read_file, ls, etc.) to verify the files actually contain the expected changes.
3. **Check for Hallucinations**: Did the developer mention a file or error that doesn't exist?
4. **Code Quality**: Check for left-over TODOs, console logs, broken imports, or inconsistent styling.
5. **Requirements Adhesion**: Re-read the original task carefully. Did they miss even a small sub-requirement?

## VERDICT MANDATE:
- If the work is 100% complete and correct: return "VERIFIED" as your first word.
- If you find ANY issue (no matter how small): return "FAIL" followed by a detailed, numbered list of failures. Be brutally honest.
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
                log.info("Adversarial audit PASSED", { taskId: task.id })
                return { ...originalResult, success: true }
            } else {
                log.warn("Adversarial audit FAILED", { taskId: task.id, reason: output })
                
                // If it fails, we wrap the output in a clear Fail record
                return { 
                    ...originalResult, 
                    success: false, 
                    output: `[VERIFICATION FAILED]\n${output}`,
                    error: `Adversarial Verification Failed` 
                }
            }
        } catch (error) {
            log.error("Error during adversarial audit", { error })
            return originalResult // Fallback to original if audit itself crashes
        }
    }
}
