import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
    BaseDeclarativeTool,
    Kind,
    type ToolInvocation,
    type ToolResult,
    BaseToolInvocation,
} from './tools.ts';
import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { DUCKDUCKGO_SEARCH_TOOL_NAME } from './tool-names.ts';

const DuckDuckGoSearchSchema = z.object({
    query: z.string().describe('Search query string.'),
    max_results: z.number().min(1).max(10).optional().default(5).describe('Number of results to return.'),
});

type DuckDuckGoSearchParams = z.infer<typeof DuckDuckGoSearchSchema>;

export class DuckDuckGoSearchTool extends BaseDeclarativeTool<DuckDuckGoSearchParams, ToolResult> {
    constructor(messageBus: MessageBus) {
        super(
            DUCKDUCKGO_SEARCH_TOOL_NAME,
            'DuckDuckGo Search',
            'Search the web using DuckDuckGo. No API key required.',
            Kind.Search,
            zodToJsonSchema(DuckDuckGoSearchSchema),
            messageBus,
            true, // isOutputMarkdown
            false, // canUpdateOutput
        );
    }

    protected createInvocation(
        params: DuckDuckGoSearchParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
    ): ToolInvocation<DuckDuckGoSearchParams, ToolResult> {
        return new DuckDuckGoSearchInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
            _kind,
            [],
        );
    }
}

class DuckDuckGoSearchInvocation extends BaseToolInvocation<DuckDuckGoSearchParams, ToolResult> {
    constructor(
        params: DuckDuckGoSearchParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
        _workspaceRoots?: readonly string[],
    ) {
        super(
            params,
            messageBus,
            _toolName ?? DUCKDUCKGO_SEARCH_TOOL_NAME,
            _toolDisplayName,
            undefined,
            _kind,
            _workspaceRoots,
        );
    }

    getDescription(): string {
        return `Searching DuckDuckGo for: "${this.params.query}"`;
    }

    async execute(_signal: AbortSignal): Promise<ToolResult> {
        const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(this.params.query)}&format=json&no_html=1&skip_disambig=1`);
        
        if (!response.ok) {
            throw new Error(`DuckDuckGo API error: ${response.statusText}`);
        }

        const data = await response.tson() as any;
        
        let output = `# DuckDuckGo Results for: ${this.params.query}\n\n`;
        
        if (data.AbstractText) {
            output += `**Abstract**: ${data.AbstractText}\nSource: ${data.AbstractURL}\n\n`;
        }
        
        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
            output += `Related Topics:\n`;
            data.RelatedTopics.slice(0, this.params.max_results).forEach((topic: any, index: number) => {
                if (topic.Text) {
                    output += `${index + 1}. [${topic.Text}](${topic.FirstURL})\n`;
                }
            });
        }

        const content = output.length < 50 ? output + "No results found via Instant Answer API." : output;

        return {
            llmContent: [{ text: content }],
            returnDisplay: `Retrieved results from DuckDuckGo Instant Answer API.`,
        };
    }
}
