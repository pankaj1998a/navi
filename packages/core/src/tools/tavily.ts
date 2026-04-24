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
import { TAVILY_SEARCH_TOOL_NAME } from './tool-names.ts';

const TavilySearchSchema = z.object({
    query: z.string().describe('Search query string.'),
    search_depth: z.enum(['basic', 'advanced']).optional().default('basic').describe('Search depth.'),
    topic: z.enum(['general', 'news', 'finance']).optional().default('general').describe('Search topic.'),
    max_results: z.number().min(1).max(20).optional().default(5).describe('Number of results to return.'),
    include_answer: z.boolean().optional().default(false).describe('Include an AI-generated answer summary.'),
});

type TavilySearchParams = z.infer<typeof TavilySearchSchema>;

export class TavilySearchTool extends BaseDeclarativeTool<TavilySearchParams, ToolResult> {
    constructor(messageBus: MessageBus) {
        super(
            TAVILY_SEARCH_TOOL_NAME,
            'Tavily Search',
            'Search the web using Tavily Search API. Optimized for AI insights.',
            Kind.Search,
            zodToJsonSchema(TavilySearchSchema),
            messageBus,
            true, // isOutputMarkdown
            false, // canUpdateOutput
        );
    }

    protected createInvocation(
        params: TavilySearchParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
    ): ToolInvocation<TavilySearchParams, ToolResult> {
        return new TavilySearchInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
            _kind,
            [], // Tavily doesn't need workspace roots as it is off-disk, but we pass empty for consistency
        );
    }
}

class TavilySearchInvocation extends BaseToolInvocation<TavilySearchParams, ToolResult> {
    constructor(
        params: TavilySearchParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
        _workspaceRoots?: readonly string[],
    ) {
        super(
            params,
            messageBus,
            _toolName ?? TAVILY_SEARCH_TOOL_NAME,
            _toolDisplayName,
            undefined,
            _kind,
            _workspaceRoots,
        );
    }

    getDescription(): string {
        return `Searching Tavily for: "${this.params.query}"`;
    }

    async execute(_signal: AbortSignal): Promise<ToolResult> {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
            throw new Error('TAVILY_API_KEY environment variable is not set.');
        }

        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                query: this.params.query,
                search_depth: this.params.search_depth,
                topic: this.params.topic,
                max_results: this.params.max_results,
                include_answer: this.params.include_answer,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Tavily API error: ${errorText}`);
        }

        const data = await response.tson() as any;
        
        let output = `Tavily Search Results for: ${this.params.query}\n\n`;
        if (data.answer) {
            output += `**Answer**: ${data.answer}\n\n`;
        }
        
        data.results.forEach((result: any, index: number) => {
            output += `${index + 1}. [${result.title}](${result.url})\n`;
            output += `   ${result.content.substring(0, 300)}...\n\n`;
        });

        return {
            llmContent: [{ text: output }],
            returnDisplay: `Found ${data.results.length} results from Tavily.`,
        };
    }
}
