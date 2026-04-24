/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { THINK_TOOL_NAME } from './tool-names.ts';
import type { ToolInvocation, ToolResult } from './tools.ts';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.ts';
import type { Config } from '../config/config.ts';

export interface ThinkToolParams {
    thought: string;
}

class ThinkToolInvocation extends BaseToolInvocation<
    ThinkToolParams,
    ToolResult
> {
    constructor(
        params: ThinkToolParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
        _workspaceRoots?: readonly string[],
    ) {
        super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
    }

    getDescription(): string {
        return `Thinking: ${this.params.thought}`;
    }

    async execute(_signal: AbortSignal): Promise<ToolResult> {
        return {
            llmContent: `Thought recorded: ${this.params.thought}`,
            returnDisplay: `Thought: ${this.params.thought}`,
        };
    }
}

export class ThinkTool extends BaseDeclarativeTool<
    ThinkToolParams,
    ToolResult
> {
    static readonly Name = THINK_TOOL_NAME;

    constructor(
        private readonly config: Config,
        messageBus: MessageBus,
    ) {
        super(
            ThinkTool.Name,
            'Think',
            'Allows the agent to record a thought or reasoning process. This tool does not have any side effects and is used for internal reasoning.',
            Kind.Think,
            {
                type: 'object',
                properties: {
                    thought: {
                        type: 'string',
                        description: 'The thought or reasoning to record.',
                    },
                },
                required: ['thought'],
            },
            messageBus,
            true, // isOutputMarkdown
            false, // canUpdateOutput
        );
    }

    protected createInvocation(
        params: ThinkToolParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
    ): ToolInvocation<ThinkToolParams, ToolResult> {
        return new ThinkToolInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
            _kind,
            this.config.getWorkspaceContext().getDirectories(),
        );
    }
}
