/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { TIME_TOOL_NAME } from './tool-names.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { Config } from '../config/config.js';

export interface TimeToolParams {
    timezone?: string;
}

class TimeToolInvocation extends BaseToolInvocation<
    TimeToolParams,
    ToolResult
> {
    constructor(
        params: TimeToolParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ) {
        super(params, messageBus, _toolName, _toolDisplayName);
    }

    getDescription(): string {
        return `Getting current time${this.params.timezone ? ` for timezone: ${this.params.timezone}` : ''}`;
    }

    async execute(_signal: AbortSignal): Promise<ToolResult> {
        try {
            const options: Intl.DateTimeFormatOptions = {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short',
            };

            if (this.params.timezone) {
                options.timeZone = this.params.timezone;
            }

            const now = new Date();
            const formatter = new Intl.DateTimeFormat('en-US', options);
            const timeString = formatter.format(now);

            return {
                llmContent: `Current time: ${timeString}`,
                returnDisplay: `Current time: ${timeString}`,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                llmContent: `Error: ${errorMessage}. Please provide a valid IANA timezone identifier (e.g., "America/New_York", "UTC").`,
                returnDisplay: `Error: ${errorMessage}`,
                error: {
                    message: errorMessage,
                },
            };
        }
    }
}

export class TimeTool extends BaseDeclarativeTool<
    TimeToolParams,
    ToolResult
> {
    static readonly Name = TIME_TOOL_NAME;

    constructor(
        private readonly config: Config,
        messageBus: MessageBus,
    ) {
        super(
            TimeTool.Name,
            'GetCurrentTime',
            'Returns the current date and time. Optionally accepts a timezone.',
            Kind.Other,
            {
                type: 'object',
                properties: {
                    timezone: {
                        type: 'string',
                        description: 'Optional IANA timezone identifier (e.g., "America/Los_Angeles", "Europe/London", "UTC"). Defaults to system timezone.',
                    },
                },
            },
            messageBus,
            true, // isOutputMarkdown
            false, // canUpdateOutput
        );
    }

    protected createInvocation(
        params: TimeToolParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ): ToolInvocation<TimeToolParams, ToolResult> {
        return new TimeToolInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
        );
    }
}
