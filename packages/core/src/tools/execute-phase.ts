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
} from './tools.ts';
import type { Config } from '../config/config.ts';
import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { EXECUTE_PHASE_TOOL_NAME } from './tool-names.ts';
import { SubagentToolWrapper } from '@navi-ai/agents';

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
        _kind?: Kind,
    ): ToolInvocation<ExecutePhaseParams, ToolResult> {
        return new ExecutePhaseInvocation(
            params,
            this.config,
            messageBus,
            _toolName,
            _toolDisplayName,
            _kind,
            this.config.getWorkspaceContext().getDirectories(),
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
        _kind?: Kind,
        _workspaceRoots?: readonly string[],
    ) {
        super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
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
