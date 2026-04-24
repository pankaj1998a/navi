/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, BaseToolInvocation, Kind, type ToolInvocation, type ToolResult } from './tools.ts';
import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { browserRuntime } from '../src/native/browser-runtime.ts';
import { ToolErrorType } from './tool-error.ts';
import { debugLogger } from '../util/debugLogger.ts';

export interface BrowserToolParams {
  action: 'navigate' | 'snapshot' | 'click' | 'type' | 'console';
  url?: string;
  ref?: string;
  text?: string;
  expression?: string;
}

export interface BrowserToolResult extends ToolResult {}

class BrowserToolInvocation extends BaseToolInvocation<BrowserToolParams, BrowserToolResult> {
  private sessionId = 'default-session';

  constructor(
    params: BrowserToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
    _workspaceRoots?: readonly string[],
  ) {
    super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
  }

  async execute(signal: AbortSignal): Promise<BrowserToolResult> {
    try {
      const page = await browserRuntime.getPage(this.sessionId);

      let resultText = '';
      switch (this.params.action) {
        case 'navigate': {
          if (!this.params.url) throw new Error('Missing url for navigate');
          await page.goto(this.params.url, { waitUntil: 'load' });
          resultText = await this.getPageSnapshot(page);
          break;
        }
        case 'snapshot': {
          resultText = await this.getPageSnapshot(page);
          break;
        }
        case 'click': {
          if (!this.params.ref) throw new Error('Missing ref for click');
          await page.click(this.params.ref);
          resultText = await this.getPageSnapshot(page);
          break;
        }
        case 'type': {
          if (!this.params.ref || !this.params.text) throw new Error('Missing ref or text for type');
          await page.fill(this.params.ref, this.params.text);
          resultText = await this.getPageSnapshot(page);
          break;
        }
        case 'console': {
          if (this.params.expression) {
            const result = await page.evaluate(this.params.expression);
            resultText = JSON.stringify(result);
          } else {
            resultText = 'Console expression missing.';
          }
          break;
        }
      }

      return {
        llmContent: `Browser Action [${this.params.action}] successful.\nOutput:\n${resultText}`,
        returnDisplay: `Browser ${this.params.action} executed.`,
      };
    } catch (e: any) {
      debugLogger.error('Browser action failed', e);
      return {
        llmContent: `Error: ${e.message}`,
        returnDisplay: `Browser ${this.params.action} failed.`,
        error: { message: e.message, type: ToolErrorType.UNKNOWN }
      };
    }
  }

  private async getPageSnapshot(page: any): Promise<string> {
    const snapshot = await page.accessibility.snapshot();
    return JSON.stringify(snapshot, null, 2);
  }

  override getDescription(): string {
    return `Browser action: ${this.params.action}`;
  }
}

export class BrowserTool extends BaseDeclarativeTool<BrowserToolParams, BrowserToolResult> {
  static readonly Name = 'browser';
  constructor(messageBus: MessageBus) {
    super(
      BrowserTool.Name,
      'Browser Automation',
      'Control a headless browser to navigate websites, click, type, and extract data via aria snapshots.',
      Kind.Execute,
      {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['navigate', 'snapshot', 'click', 'type', 'console'] },
          url: { type: 'string' },
          ref: { type: 'string', description: 'CSS Selector or Locator' },
          text: { type: 'string' },
          expression: { type: 'string' }
        },
        required: ['action']
      },
      messageBus
    );
  }

  protected createInvocation(
    params: BrowserToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
  ): ToolInvocation<BrowserToolParams, BrowserToolResult> {
    return new BrowserToolInvocation(
      params,
      messageBus,
      _toolName ?? this.name,
      _toolDisplayName ?? this.displayName,
      _kind,
      [], // Browser is off-disk
    );
  }
}
