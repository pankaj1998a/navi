import { AgentTemplate, AgentStep, AgentRegistry } from "../programmatic"
import { ulid } from "ulid"

/**
 * Researcher Agent Role
 * Specialized in deep research using parallel sub-agents and summarized search.
 */
const ResearcherAgent: AgentTemplate = {
    id: "researcher",
    name: "Web Researcher",
    description: "Specialized in deep research using parallel sub-agents and summarized search.",
    tools: ["websearch", "googlesearch", "task", "read", "write", "edit", "bash"],

    async *handleSteps(context): AsyncGenerator<AgentStep, string | void, any> {
        yield {
            type: "step",
            name: "Analyzing research requirements"
        }

        yield {
            type: "step",
            name: "Spawning 6 parallel surfer agents (Web Search, Google AI, Docs, GitHub, StackOverflow, Community)"
        }

        const topic = context.input
        const subtasks: AgentStep[] = [
            {
                type: "subtask",
                agent: "surfer",
                description: `Web Search: ${topic}`,
                prompt: `Use websearch to search for "${topic} 2026" AND "${topic} 2025". Fetch the top 3 result URLs. Summarize key findings with source URLs.`
            },
            {
                type: "subtask",
                agent: "surfer",
                description: `Google AI Search: ${topic}`,
                prompt: `Use googlesearch for "${topic}". Focus on a synthesized overview, latest docs, and code snippets. Include cited URLs from the returned results.`
            },
            {
                type: "subtask",
                agent: "surfer",
                description: `Official Docs: ${topic}`,
                prompt: `Identify the official documentation site for the main technology in: ${topic}. Use webcrawl (maxDepth:2, maxPages:12, sameDomain:true) to extract architecture, core concepts, and API reference. Summarize the official recommended approach.`
            },
            {
                type: "subtask",
                agent: "surfer",
                description: `GitHub: ${topic}`,
                prompt: `Use websearch with "site:github.com ${topic}" to find relevant repositories, issues, and discussions. Fetch the top 2 most relevant pages and summarize code patterns, open issues, and community consensus.`
            },
            {
                type: "subtask",
                agent: "surfer",
                description: `Stack Overflow: ${topic}`,
                prompt: `Use websearch with "site:stackoverflow.com ${topic}" to find community solutions. Fetch the top 2 questions. Report accepted answers, edge cases, and common gotchas.`
            },
            {
                type: "subtask",
                agent: "surfer",
                description: `Community Sources: ${topic}`,
                prompt: `Use websearch with "${topic} blog OR discussion OR comparison 2026" and fetch the top 2 relevant community pages. Summarize practical tradeoffs, migration pain points, and any warnings.`
            }
        ]

        for (const subtask of subtasks) {
            yield subtask
        }

        yield {
            type: "step",
            name: "Synthesizing results from all 6 sources"
        }

        return `Research complete for: ${topic}. Results gathered from Web Search, Google AI Search, Official Docs, GitHub, Stack Overflow, and Community sources. See sub-agent reports above for details.`
    }
}

AgentRegistry.register(ResearcherAgent)
export { ResearcherAgent }
export default ResearcherAgent


