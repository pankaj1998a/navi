import { AgentTemplate, AgentStep, AgentRegistry } from "../programmatic"

/**
 * Surfer Agent Role
 * Focused on fast and accurate web browsing and summarization.
 */
const SurferAgent: AgentTemplate = {
    id: "surfer",
    name: "Web Surfer",
    description: "Focused on fast and accurate web browsing and summarization.",
    tools: ["googlesearch", "websearch", "webfetch", "webcrawl", "webscrape", "read", "write", "edit", "bash"],

    async *handleSteps(context): AsyncGenerator<AgentStep, string | void, any> {
        const input = context.input.toLowerCase();
        const isGoogleAi = input.includes("google ai search");
        const isWebSearch = input.includes("web search");

        yield {
            type: "step",
            name: isGoogleAi ? `Performing Google AI Search: ${context.input}` :
                isWebSearch ? `Performing Web Search: ${context.input}` :
                    `Searching for: ${context.input}`
        }

        if (isGoogleAi) {
            const result = yield {
                type: "tool",
                name: "googlesearch",
                input: { query: context.input }
            }
            return result?.output || "No Google AI Search results found.";
        }

        if (isWebSearch) {
            const result = yield {
                type: "tool",
                name: "websearch",
                input: { query: context.input, type: "deep" }
            }
            return result?.output || "No Web Search results found.";
        }

        // Default behavior: try Google AI, fallback to Web Search
        const result = yield {
            type: "tool",
            name: "googlesearch",
            input: { query: context.input }
        }

        if (!result || !result.output || result.output.includes("No search results found")) {
            yield { type: "step", name: "Retrying with broader search" }
            const retryResult = yield {
                type: "tool",
                name: "websearch",
                input: { query: context.input, type: "deep" }
            }
            return retryResult?.output || "No results found even after deep search."
        }

        return result.output
    }
}

AgentRegistry.register(SurferAgent)
export { SurferAgent }
export default SurferAgent
