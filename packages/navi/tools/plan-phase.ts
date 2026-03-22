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
import { PLAN_PHASE_TOOL_NAME } from './tool-names.js';
import { SubagentToolWrapper } from '../agents/subagent-tool-wrapper.js';

const PlanPhaseSchema = z.object({
    objective: z.string().describe('The objective or feature to plan.'),
    context_files: z.array(z.string()).optional().describe('Specific files to include in the planning context.'),
});

type PlanPhaseParams = z.infer<typeof PlanPhaseSchema>;

export class PlanPhaseTool extends BaseDeclarativeTool<
    PlanPhaseParams,
    ToolResult
> {
    static readonly Name = PLAN_PHASE_TOOL_NAME;

    constructor(
        private readonly config: Config,
        messageBus: MessageBus,
    ) {
        super(
            PlanPhaseTool.Name,
            'Plan Phase',
            'Generates a structured GSD plan for a specific objective. Spawns a planner agent to break down the task into atomic, executable steps.',
            Kind.Think,
            zodToJsonSchema(PlanPhaseSchema),
            messageBus,
            true,
            true,
        );
    }

    protected createInvocation(
        params: PlanPhaseParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ): ToolInvocation<PlanPhaseParams, ToolResult> {
        return new PlanPhaseInvocation(
            params,
            this.config,
            messageBus,
            _toolName,
            _toolDisplayName,
        );
    }
}

class PlanPhaseInvocation extends BaseToolInvocation<
    PlanPhaseParams,
    ToolResult
> {
    constructor(
        params: PlanPhaseParams,
        private readonly config: Config,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ) {
        super(params, messageBus, _toolName, _toolDisplayName);
    }

    getDescription(): string {
        return `Planning phase for objective: ${this.params.objective}...`;
    }

    async execute(
        signal: AbortSignal,
        updateOutput?: (output: string) => void,
    ): Promise<ToolResult> {
        const registry = this.config.getAgentRegistry();
        const plannerDef = registry.getDefinition('planner');

        if (!plannerDef) {
            throw new Error('planner agent not found in registry');
        }

        if (updateOutput) updateOutput(`🚀 Spawning planner for objective: ${this.params.objective}...\n`);

        const wrapper = new SubagentToolWrapper(plannerDef, this.config, this.messageBus);

        const contextStr = this.params.context_files?.length
            ? `\nContext files: ${this.params.context_files.join(', ')}`
            : '';

        const invocation = wrapper.build({
            query: `${this.params.objective}${contextStr}`,
        });

        const result = await invocation.execute(signal, (out) => {
            if (typeof out === 'string') {
                updateOutput?.(out);
            }
        });

        return {
            llmContent: `Planning complete.\n\n${result.llmContent}`,
            returnDisplay: result.returnDisplay,
        };
    }
}
