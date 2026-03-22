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
import { EXECUTE_PHASE_TOOL_NAME } from './tool-names.js';
import { SubagentToolWrapper } from '../agents/subagent-tool-wrapper.js';

const ExecutePhaseSchema = z.object({
    plan_path: z.string().describe('The path to the PLAN.md file to execute.'),
});

type ExecutePhaseParams = z.infer<typeof ExecutePhaseSchema>;

export class ExecutePhaseTool extends BaseDeclarativeTool<
    ExecutePhaseParams,
    ToolResult
> {
    static readonly Name = EXECUTE_PHASE_TOOL_NAME;

    constructor(
        private readonly config: Config,
        messageBus: MessageBus,
    ) {
        super(
            ExecutePhaseTool.Name,
            'Execute Phase',
            'Executes a GSD plan from a PLAN.md file. Spawns an executor agent to perform tasks atomically with git commits.',
            Kind.Execute,
            zodToJsonSchema(ExecutePhaseSchema),
            messageBus,
            true,
            true,
        );
    }

    protected createInvocation(
        params: ExecutePhaseParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ): ToolInvocation<ExecutePhaseParams, ToolResult> {
        return new ExecutePhaseInvocation(
            params,
            this.config,
            messageBus,
            _toolName,
            _toolDisplayName,
        );
    }
}

class ExecutePhaseInvocation extends BaseToolInvocation<
    ExecutePhaseParams,
    ToolResult
> {
    constructor(
        params: ExecutePhaseParams,
        private readonly config: Config,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ) {
        super(params, messageBus, _toolName, _toolDisplayName);
    }

    getDescription(): string {
        return `Executing plan: ${this.params.plan_path}...`;
    }

    async execute(
        signal: AbortSignal,
        updateOutput?: (output: string) => void,
    ): Promise<ToolResult> {
        const registry = this.config.getAgentRegistry();
        const executorDef = registry.getDefinition('executor');

        if (!executorDef) {
            throw new Error('executor agent not found in registry');
        }

        if (updateOutput) updateOutput(`🚀 Spawning executor for plan: ${this.params.plan_path}...\n`);

        const wrapper = new SubagentToolWrapper(executorDef, this.config, this.messageBus);

        const invocation = wrapper.build({
            query: this.params.plan_path,
        });

        const result = await invocation.execute(signal, (out) => {
            if (typeof out === 'string') {
                updateOutput?.(out);
            }
        });

        return {
            llmContent: `Execution complete.\n\n${result.llmContent}`,
            returnDisplay: result.returnDisplay,
        };
    }
}
