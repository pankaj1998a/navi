import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
    BaseDeclarativeTool,
    Kind,
    type ToolInvocation,
    type ToolResult,
    BaseToolInvocation,
} from './tools.ts';
import type { AnsiOutput } from '../util/terminalSerializer.ts';
import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { MemoryManager } from '../src/agent/memory-manager.ts';

const MEMORY_SEARCH_TOOL_NAME = 'memory_search';

const MemorySearchSchema = z.object({
    query: z.string().describe('The search query or concept to find in memory.'),
    limit: z.number().optional().default(5).describe('Maximum number of results to return (default 5).'),
    tier: z.enum(['short', 'medium', 'long']).optional().describe('Specific memory tier to search within. If omitted, searches all available memory tiers.'),
    tags: z.array(z.string()).optional().describe('Optional tags to filter the memories.'),
});

type MemorySearchParams = z.infer<typeof MemorySearchSchema>;

export class MemorySearchTool extends BaseDeclarativeTool<
    MemorySearchParams,
    ToolResult
> {
    constructor(messageBus: MessageBus) {
        super(
            MEMORY_SEARCH_TOOL_NAME,
            'Memory Search',
            'Search the agent memory tiers (short, medium, long) for past context, architecture decisions, and learning.',
            Kind.Think,
            zodToJsonSchema(MemorySearchSchema),
            messageBus,
            true, // isOutputMarkdown
            true, // canUpdateOutput
        );
    }

    protected createInvocation(
        params: MemorySearchParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
    ): ToolInvocation<MemorySearchParams, ToolResult> {
        return new MemorySearchInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
            _kind,
            [], // Search is generally off-disk or uses indexed memory
        );
    }
}

class MemorySearchInvocation extends BaseToolInvocation<
    MemorySearchParams,
    ToolResult
> {
    constructor(
        params: MemorySearchParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
        _workspaceRoots?: readonly string[],
    ) {
        super(
            params,
            messageBus,
            _toolName ?? MEMORY_SEARCH_TOOL_NAME,
            _toolDisplayName,
            undefined,
            _kind,
            _workspaceRoots,
        );
    }

    getDescription(): string {
        return `Searching memory for: "${this.params.query}"`;
    }

    async execute(
        _signal: AbortSignal,
        updateOutput?: (output: string | AnsiOutput) => void,
    ): Promise<ToolResult> {
        if (updateOutput) {
            updateOutput(`🔍 Searching memory for "${this.params.query}"...\n`);
        }

        const options: MemoryManager.RecallOptions = {
            limit: this.params.limit,
            tier: this.params.tier,
            tags: this.params.tags,
        };

        const results = await MemoryManager.search(this.params.query, options);

        if (results.length === 0) {
            const noResults = `No memory entries found matching query: "${this.params.query}"`;
            if (updateOutput) updateOutput(noResults);
            return {
                llmContent: [{ text: noResults }],
                returnDisplay: noResults,
            };
        }

        const lines: string[] = [
            `# Memory Search Results`,
            ``,
            `Found ${results.length} entries for "${this.params.query}":`,
            ``,
        ];

        for (const entry of results) {
            lines.push(`### [${entry.tier.toUpperCase()}] Memory Entry (ID: ${entry.id})`);
            lines.push(`**Importance:** ${entry.importance.toFixed(2)} | **Tags:** ${entry.tags.join(', ') || 'none'}`);
            lines.push(`**Created:** ${new Date(entry.createdAt).toISOString()}`);
            lines.push(`\n${entry.content}\n`);
            lines.push(`---`);
        }

        const displayContent = lines.join('\n');

        if (updateOutput) {
            updateOutput(displayContent);
        }

        return {
            llmContent: [{ text: displayContent }],
            returnDisplay: displayContent,
        };
    }
}
