import { Log } from "../util/log"

const log = Log.create({ service: "tool-loop-detection" })

export interface ToolCallRecord {
    tool: string
    args: any
    timestamp: number
}

/**
 * ToolLoopDetector prevents agents from entering infinite tool call loops.
 * It tracks tool execution history per session and blocks repetitive calls.
 */
export class ToolLoopDetector {
    private static history: Map<string, ToolCallRecord[]> = new Map()
    private static MAX_HISTORY = 20
    private static REPETITION_THRESHOLD = 3

    /**
     * Checks if the current tool call constitutes a loop and records it.
     * @returns { isLoop: boolean; message?: string }
     */
    static check(sessionID: string, tool: string, args: any): { isLoop: boolean; message?: string } {
        let sessionHistory = this.history.get(sessionID) || []
        
        // Normalize args for comparison (simple JSON stringify)
        const currentArgsStr = JSON.stringify(args)
        
        // 1. Detect consecutive identical calls
        let consecutiveCount = 0
        for (let i = sessionHistory.length - 1; i >= 0; i--) {
            const record = sessionHistory[i]
            if (record.tool === tool && JSON.stringify(record.args) === currentArgsStr) {
                consecutiveCount++
            } else {
                break
            }
        }

        if (consecutiveCount >= this.REPETITION_THRESHOLD) {
            log.warn("consecutive tool loop detected", { sessionID, tool, count: consecutiveCount + 1 })
            return {
                isLoop: true,
                message: `⚠️ Loop detected: You have called '${tool}' with the exact same arguments ${consecutiveCount + 1} times in a row. This approach is not working. Please try a different tool or modify your strategy to avoid repetitive failures.`
            }
        }

        // 2. Detect circular loops (e.g., A -> B -> A -> B)
        // We look for a repeating pattern in the last N calls
        if (sessionHistory.length >= 4) {
             const last4 = sessionHistory.slice(-3).map(r => `${r.tool}:${JSON.stringify(r.args)}`)
             const current = `${tool}:${currentArgsStr}`
             
             // If current matches the call from 2 steps ago, and the one from 4 steps ago (if exists)
             if (sessionHistory.length >= 4) {
                 const stepMinus2 = `${sessionHistory[sessionHistory.length - 2].tool}:${JSON.stringify(sessionHistory[sessionHistory.length - 2].args)}`
                 const stepMinus4 = `${sessionHistory[sessionHistory.length - 4].tool}:${JSON.stringify(sessionHistory[sessionHistory.length - 4].args)}`
                 
                 if (current === stepMinus2 && stepMinus2 === stepMinus4) {
                     log.warn("circular tool loop detected", { sessionID, pattern: [tool, sessionHistory[sessionHistory.length-1].tool] })
                     return {
                         isLoop: true,
                         message: `⚠️ Circular loop detected: You are alternating between the same set of tool calls without making progress. Please break the cycle and try a different path.`
                     }
                 }
             }
        }

        // Add to history
        sessionHistory.push({ tool, args, timestamp: Date.now() })
        if (sessionHistory.length > this.MAX_HISTORY) {
            sessionHistory.shift()
        }
        this.history.set(sessionID, sessionHistory)

        return { isLoop: false }
    }

    /**
     * Clears history for a session (e.g. when a user sends a new message)
     */
    static clear(sessionID: string) {
        this.history.delete(sessionID)
    }
}
