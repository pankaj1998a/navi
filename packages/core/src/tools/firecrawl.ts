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
import { FIRECRAWL_TOOL_NAME } from './tool-names.ts';

const FirecrawlSchema = z.object({
    action: z.enum(['scrape', 'crawl']).describe('Action to perform.'),
    url: z.string().describe('Target URL.'),
    formats: z.array(z.string()).optional().default(['markdown']).describe('Requested formats (e.g., markdown, html, screenshot).'),
});

type FirecrawlParams = z.infer<typeof FirecrawlSchema>;

export class FirecrawlTool extends BaseDeclarativeTool<FirecrawlParams, ToolResult> {
    constructor(messageBus: MessageBus) {
        super(
            FIRECRAWL_TOOL_NAME,
            'Firecrawl',
            'Scrape or crawl websites using Firecrawl into agent-friendly Markdown.',
            Kind.Fetch,
            zodToJsonSchema(FirecrawlSchema),
            messageBus,
            true, // isOutputMarkdown
            false, // canUpdateOutput
        );
    }

    protected createInvocation(
        params: FirecrawlParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
    ): ToolInvocation<FirecrawlParams, ToolResult> {
        return new FirecrawlInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
            _kind,
            [],
        );
    }
}

class FirecrawlInvocation extends BaseToolInvocation<FirecrawlParams, ToolResult> {
    constructor(
        params: FirecrawlParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
        _workspaceRoots?: readonly string[],
    ) {
        super(
            params,
            messageBus,
            _toolName ?? FIRECRAWL_TOOL_NAME,
            _toolDisplayName,
            undefined,
            _kind,
            _workspaceRoots,
        );
    }

    getDescription(): string {
        return `${this.params.action === 'scrape' ? 'Scraping' : 'Crawling'} ${this.params.url} with Firecrawl`;
    }

    async execute(_signal: AbortSignal): Promise<ToolResult> {
        const apiKey = process.env.FIRECRAWL_API_KEY;
        if (!apiKey) {
            throw new Error('FIRECRAWL_API_KEY environment variable is not set.');
        }

        const endpoint = this.params.action === 'scrape' ? 'https://api.firecrawl.dev/v1/scrape' : 'https://api.firecrawl.dev/v1/crawl';
        const body: any = {
            url: this.params.url,
            formats: this.params.formats,
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firecrawl API error: ${errorText}`);
        }

        const data = await response.tson() as any;
        
        let content: string;
        if (this.params.action === 'scrape') {
            const result = data.data;
            content = `### Scraped Content from ${this.params.url}\n\n${result.markdown || 'No markdown content available.'}`;
        } else {
            content = `### Crawl started for ${this.params.url}\n\nJob ID: ${data.id}\nStatus: ${data.status}\nCheck progress at: ${data.url}`;
        }

        return {
            llmContent: [{ text: content }],
            returnDisplay: `Firecrawl ${this.params.action} action completed successfully.`,
        };
    }
}
