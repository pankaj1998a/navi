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
import { EXA_SEARCH_TOOL_NAME } from './tool-names.ts';

const ExaSearchSchema = z.object({
    query: z.string().describe('Search query string.'),
    type: z.enum(['auto', 'neural', 'fast', 'deep', 'deep-reasoning', 'instant']).optional().default('auto').describe('Exa search mode.'),
    count: z.number().min(1).max(100).optional().default(10).describe('Number of results to return.'),
    freshness: z.enum(['day', 'week', 'month', 'year']).optional().describe('Filter by time.'),
    contents: z.object({
        highlights: z.boolean().optional().default(true).describe('Include highlights.'),
        summary: z.boolean().optional().default(false).describe('Include summary.'),
        text: z.boolean().optional().default(false).describe('Include full text.'),
    }).optional().describe('Content extraction options.'),
});

type ExaSearchParams = z.infer<typeof ExaSearchSchema>;

export class ExaSearchTool extends BaseDeclarativeTool<ExaSearchParams, ToolResult> {
    constructor(messageBus: MessageBus) {
        super(
            EXA_SEARCH_TOOL_NAME,
            'Exa Search',
            'Search the web using Exa AI. Supports neural search and content extraction.',
            Kind.Search,
            zodToJsonSchema(ExaSearchSchema),
            messageBus,
            true, // isOutputMarkdown
            false, // canUpdateOutput
        );
    }

    protected createInvocation(
        params: ExaSearchParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
    ): ToolInvocation<ExaSearchParams, ToolResult> {
        return new ExaSearchInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
            _kind,
            [],
        );
    }
}

class ExaSearchInvocation extends BaseToolInvocation<ExaSearchParams, ToolResult> {
    constructor(
        params: ExaSearchParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
        _workspaceRoots?: readonly string[],
    ) {
        super(
            params,
            messageBus,
            _toolName ?? EXA_SEARCH_TOOL_NAME,
            _toolDisplayName,
            undefined,
            _kind,
            _workspaceRoots,
        );
    }

    getDescription(): string {
        return `Searching Exa for: "${this.params.query}"`;
    }

    async execute(_signal: AbortSignal): Promise<ToolResult> {
        const apiKey = process.env.EXA_API_KEY;
        if (!apiKey) {
            throw new Error('EXA_API_KEY environment variable is not set.');
        }

        const body: any = {
            query: this.params.query,
            numResults: this.params.count,
            type: this.params.type,
            contents: this.params.contents || { highlights: true },
        };

        if (this.params.freshness) {
            const now = new Date();
            if (this.params.freshness === 'day') now.setDate(now.getDate() - 1);
            if (this.params.freshness === 'week') now.setDate(now.getDate() - 7);
            if (this.params.freshness === 'month') now.setMonth(now.getMonth() - 1);
            if (this.params.freshness === 'year') now.setFullYear(now.getFullYear() - 1);
            body.startPublishedDate = now.toISOString();
        }

        const response = await fetch('https://api.exa.ai/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Exa API error: ${errorText}`);
        }

        const data = await response.tson() as any;
        
        let output = `# Exa Search Results for: ${this.params.query}\n\n`;
        
        data.results.forEach((result: any, index: number) => {
            output += `### ${index + 1}. [${result.title || result.url}](${result.url})\n`;
            if (result.publishedDate) output += `**Date**: ${result.publishedDate}\n`;
            if (result.summary) output += `**Summary**: ${result.summary}\n`;
            if (result.highlights && result.highlights.length > 0) {
                output += `**Highlights**:\n- ${result.highlights.join('\n- ')}\n`;
            }
            output += `\n---\n`;
        });

        return {
            llmContent: [{ text: output }],
            returnDisplay: `Retrieved ${data.results.length} neural search results from Exa.`,
        };
    }
}
