import { AgentTemplate } from "../programmatic"

/**
 * BugBuster Agent
 * Phase: Debug
 * Responsibility: Finding and squashing bugs, regression testing.
 */
export const BugBuster: AgentTemplate = {
    id: "bug-buster",
    name: "BugBuster",
    description: "Expert at root cause analysis and fixing complex software bugs",
    tools: ["read", "edit", "grep", "terminal"],
    phase: "debug",
    skills: ["systematic-debugging", "debug-cli", "diagnose-agent", "resolve-conflicts"],
    handleSteps: async function* (context) {
        yield { type: "step", name: "Error Replication", description: "Analyzing bug reports and reproducing the issue locally" }
        yield { type: "log", message: "Tracing stack traces and state transitions..." }
        yield { type: "step", name: "Root Cause Diagnosis", description: "Identifying the precise failure point in the logic" }
        yield { type: "step", name: "Fix Implementation", description: "Applying targeted patches and verifying with regression tests" }
        yield { type: "finish", result: "Bugs verified as squashed and system health restored." }
    }
}
