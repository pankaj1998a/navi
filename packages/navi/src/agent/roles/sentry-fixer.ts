import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

/**
 * Sentry-Fixer Agent
 * Specialized in resolving background verification failures (lints, type errors, tests).
 */
export const SentryFixerAgent: AgentTemplate = {
  id: "sentry-fixer",
  name: "Sentry Fixer",
  description: "Specialized in resolving background verification failures (lints, type errors).",
  phase: "debug",
  skills: ["debugging", "verification"],
  tools: ["read", "edit", "patch", "lsp", "bash"],
  handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
    yield { type: "step", name: "Analyzing verification failure" }

    const failureDetails = context.input
    yield { type: "log", message: `Received failure report: ${failureDetails.slice(0, 100)}...` }

    // 1. Diagnostics using LSP or grep
    yield { type: "step", name: "Gathering diagnostics" }
    const diagnostics = yield {
      type: "tool",
      name: "bash",
      input: { command: "npm run lint" } // Re-run to get fresh output if needed, or parse input
    }

    // 2. Attempt fix
    yield { type: "step", name: "Applying fixes" }
    yield { type: "log", message: "Attempting to fix identified issues..." }
    
    // In a real implementation, this would involve complex logic to parse errors and apply edits.
    // For this Level 3 implementation, we provide the agent with the necessary tools to iterate.
    
    yield { type: "finish", result: "Sentry Fixer has attempted to resolve the verification errors. Please check the latest status." }
  }
}

AgentRegistry.register(SentryFixerAgent)


