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
import { VERIFY_WORK_TOOL_NAME } from './tool-names.js';
import { SubagentToolWrapper } from '../agents/subagent-tool-wrapper.js';

const VerifyWorkSchema = z.object({
    scope: z.string().optional().describe('The scope of work to verify (e.g., specific files or recent commits).'),
});

type VerifyWorkParams = z.infer<typeof VerifyWorkSchema>;

export class VerifyWorkTool extends BaseDeclarativeTool<
    VerifyWorkParams,
    ToolResult
> {
    static readonly Name = VERIFY_WORK_TOOL_NAME;

    constructor(
        private readonly config: Config,
        messageBus: MessageBus,
    ) {
        super(
            VerifyWorkTool.Name,
            'Verify Work',
            'Verifies the completed work against project standards and requirements. Spawns a code-reviewer agent to perform a high-confidence review.',
            Kind.Think,
            zodToJsonSchema(VerifyWorkSchema),
            messageBus,
            true,
            true,
        );
    }

    protected createInvocation(
        params: VerifyWorkParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ): ToolInvocation<VerifyWorkParams, ToolResult> {
        return new VerifyWorkInvocation(
            params,
            this.config,
            messageBus,
            _toolName,
            _toolDisplayName,
        );
    }
}

class VerifyWorkInvocation extends BaseToolInvocation<
    VerifyWorkParams,
    ToolResult
> {
    constructor(
        params: VerifyWorkParams,
        private readonly config: Config,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ) {
        super(params, messageBus, _toolName, _toolDisplayName);
    }

    getDescription(): string {
        return `Verifying work scope: ${this.params.scope ?? 'recent changes'}...`;
    }

    async execute(
        signal: AbortSignal,
        updateOutput?: (output: string) => void,
    ): Promise<ToolResult> {
        const registry = this.config.getAgentRegistry();
        const reviewerDef = registry.getDefinition('code-reviewer');

        if (!reviewerDef) {
            throw new Error('code-reviewer agent not found in registry');
        }

        if (updateOutput) updateOutput(`🚀 Spawning code-reviewer for scope: ${this.params.scope ?? 'recent changes'}...\n`);

        const wrapper = new SubagentToolWrapper(reviewerDef, this.config, this.messageBus);

        const invocation = wrapper.build({
            query: this.params.scope ?? 'Review the most recent changes and ensure they meet project standards.',
        });

        const result = await invocation.execute(signal, (out) => {
            if (typeof out === 'string') {
                updateOutput?.(out);
            }
        });

        return {
            llmContent: `Verification complete.\n\n${result.llmContent}`,
            returnDisplay: result.returnDisplay,
        };
    }
}
