/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { CALCULATOR_TOOL_NAME } from './tool-names.ts';
import type { ToolInvocation, ToolResult } from './tools.ts';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.ts';
import type { Config } from '../config/config.ts';

export interface CalculatorToolParams {
    expression: string;
}

class CalculatorToolInvocation extends BaseToolInvocation<
    CalculatorToolParams,
    ToolResult
> {
    constructor(
        params: CalculatorToolParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
        _kind?: Kind,
        _workspaceRoots?: readonly string[],
    ) {
        super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
    }

    getDescription(): string {
        return `Calculating: ${this.params.expression}`;
    }

    async execute(_signal: AbortSignal): Promise<ToolResult> {
        try {
            // Basic validation to prevent arbitrary code execution
            if (!/^[0-9+\-*/().\s]+$/.test(this.params.expression)) {
                throw new Error('Invalid characters in expression. Only numbers and basic operators (+, -, *, /, ., (, )) are allowed.');
            }

            // eslint-disable-next-line no-new-func
            const result = new Function(`return ${this.params.expression}`)();

            return {
                llmContent: `Result: ${result}`,
                returnDisplay: `Result: ${result}`,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                llmContent: `Error: ${errorMessage}`,
                returnDisplay: `Error: ${errorMessage}`,
                error: {
                    message: errorMessage,
                },
            };
        }
    }
}

export class CalculatorTool extends BaseDeclarativeTool<
    CalculatorToolParams,
    ToolResult
> {
    static readonly Name = CALCULATOR_TOOL_NAME;

    constructor(
        private readonly config: Config,
        messageBus: MessageBus,
    ) {
        super(
            CalculatorTool.Name,
            'Calculator',
            'Performs basic arithmetic calculations. Supports +, -, *, /, and parentheses.',
            Kind.Other,
            {
                type: 'object',
                properties: {
                    expression: {
                        type: 'string',
                        description: 'The mathematical expression to evaluate (e.g., "2 + 2 * (3 - 1)").',
                    },
                },
                required: ['expression'],
            },
            messageBus,
            true, // isOutputMarkdown
            false, // canUpdateOutput
        );
    }

    protected createInvocation(
        params: CalculatorToolParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    _kind?: Kind,
  ): ToolInvocation<CalculatorToolParams, ToolResult> {
    return new CalculatorToolInvocation(
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
      _kind,
      [], // Calculator is off-disk
    );
  }
}
