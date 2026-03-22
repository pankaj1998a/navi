/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
    BaseDeclarativeTool,
    Kind,
    type ToolInvocation,
    type ToolResult,
    BaseToolInvocation,
} from './tools.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { MAP_CODEBASE_TOOL_NAME } from './tool-names.js';
import { SubagentToolWrapper } from '../agents/subagent-tool-wrapper.js';
import { debugLogger } from '../utils/debugLogger.js';

const MapCodebaseSchema = z.object({
    focus_area: z.enum(['tech', 'arch', 'quality', 'concerns', 'all']).default('all').describe('The focus area for mapping.'),
    instructions: z.string().optional().describe('Specific instructions for the mapping process.'),
});

type MapCodebaseParams = z.infer<typeof MapCodebaseSchema>;

export class MapCodebaseTool extends BaseDeclarativeTool<
    MapCodebaseParams,
    ToolResult
> {
    static readonly Name = MAP_CODEBASE_TOOL_NAME;

    constructor(
        private readonly config: Config,
        messageBus: MessageBus,
    ) {
        super(
            MapCodebaseTool.Name,
            'Map Codebase',
            'Automatically maps the codebase architecture and dependencies by spawning specialized investigator agents. Writes artifacts to .planning/codebase/.',
            Kind.Think,
            zodToJsonSchema(MapCodebaseSchema),
            messageBus,
            true,
            true,
        );
    }

    protected createInvocation(
        params: MapCodebaseParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ): ToolInvocation<MapCodebaseParams, ToolResult> {
        return new MapCodebaseInvocation(
            params,
            this.config,
            messageBus,
            _toolName,
            _toolDisplayName,
        );
    }
}

class MapCodebaseInvocation extends BaseToolInvocation<
    MapCodebaseParams,
    ToolResult
> {
    constructor(
        params: MapCodebaseParams,
        private readonly config: Config,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ) {
        super(params, messageBus, _toolName, _toolDisplayName);
    }

    getDescription(): string {
        return `Mapping codebase focus area: ${this.params.focus_area}...`;
    }

    async execute(
        signal: AbortSignal,
        updateOutput?: (output: string) => void,
    ): Promise<ToolResult> {
        const registry = this.config.getAgentRegistry();
        const mapperDef = registry.getDefinition('codebase-mapper');

        if (!mapperDef) {
            throw new Error('codebase-mapper agent not found in registry');
        }

        if (updateOutput) updateOutput(`🚀 Spawning codebase-mapper for focus: ${this.params.focus_area}...\n`);

        const wrapper = new SubagentToolWrapper(mapperDef, this.config, this.messageBus);

        const areas = this.params.focus_area === 'all'
            ? ['tech', 'arch', 'quality', 'concerns']
            : [this.params.focus_area];

        const results: string[] = [];

        for (const area of areas) {
            if (signal.aborted) break;

            if (updateOutput) updateOutput(`\n--- Mapping ${area} ---\n`);

            const invocation = wrapper.build({
                query: `${area}${this.params.instructions ? `: ${this.params.instructions}` : ''}`,
            });

            const result = await invocation.execute(signal, (out) => {
                if (typeof out === 'string') {
                    updateOutput?.(out);
                }
            });

            results.push(`### ${area}\n${result.llmContent}`);
        }

        const finalSummary = results.join('\n\n');

        return {
            llmContent: `Codebase mapping complete.\n\n${finalSummary}`,
            returnDisplay: finalSummary,
        };
    }
}
