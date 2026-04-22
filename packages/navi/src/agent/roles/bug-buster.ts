import { AgentRegistry, AgentTemplate, AgentContext, AgentStep } from "../programmatic"

const BugBusterAgent: AgentTemplate = {
  id: "bug-buster",
  name: "Bug Buster",
  description: "Static analysis, edge-case detection, and requirement drift auditing.",
  phase: "debug",
  skills: ["static-analysis", "code-auditing", "error-detection"],
  tools: ["read", "grep", "glob", "bash", "write"],
  systemPrompt: `You are a senior software engineer specialising in code quality and correctness.
Your job is to exhaustively audit the codebase and find:
1. Logic errors and off-by-one bugs
2. Unhandled error paths and silent failures
3. Race conditions and concurrency issues
4. Scope drift — features present in the code but not in the requirements, or missing
4. Missing input validation

You produce a structured report with severity: critical / warning / info.
You never fix code yourself — you report findings so they can be turned into tasks.`,

  handleSteps: async function* (context: AgentContext): AsyncGenerator<AgentStep, string | void, any> {
    yield { type: "step", name: "Reading requirement baseline" }

    yield {
      type: "tool",
      name: "read",
      input: { filePath: ".vibe/requirement.md" }
    }

    yield { type: "step", name: "Scanning codebase for logic errors and unhandled paths" }

    // Search for common error-handling anti-patterns
    yield {
      type: "subtask",
      agent: "bug-buster",
      description: "Find unhandled promise rejections",
      prompt: `Use grep to search for 'async' functions that do NOT have try-catch or .catch() handlers.
Also find any 'await' calls without surrounding error handling.
Report file path, line number, and snippet for each finding.`
    }

    yield {
      type: "subtask",
      agent: "bug-buster",
      description: "Find missing input validation",
      prompt: `Search for functions that accept user input (parameters named: input, data, body, req, query, params, args)
and don't validate or sanitize before first use.
Report file path, line number, and the parameter name.`
    }

    yield {
      type: "subtask",
      agent: "bug-buster",
      description: "Check for silent failures",
      prompt: `Search the codebase for empty catch blocks, catch blocks that only call console.error,
and try-catch blocks without any recovery logic.
Report each as: file:line — snippet`
    }

    yield {
      type: "subtask",
      agent: "bug-buster",
      description: "Requirement drift check",
      prompt: `Read .vibe/requirement.md and .vibe/task.md (if present).
Scan the implemented source files and check:
1. Are there features implemented that are not in the requirements?
2. Are any requirements specified but not yet implemented?
Report each finding with: [EXTRA] or [MISSING] prefix, requirement quote, and file reference.`
    }

    yield { type: "step", name: "Compiling bug report" }

    yield {
      type: "finish",
      result: `Bug sweep complete. All findings have been categorised as critical / warning / info.
Review the sub-agent reports above. Avni will create fix tasks for all critical findings.`
    }
  }
}

AgentRegistry.register(BugBusterAgent)
export { BugBusterAgent }
export default BugBusterAgent
