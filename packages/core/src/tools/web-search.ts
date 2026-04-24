/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { WEB_SEARCH_TOOL_NAME } from './tool-names.ts';
import type { GroundingMetadata } from '@google/genai';
import type { ToolInvocation, ToolResult } from './tools.ts';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.ts';
import { ToolErrorType } from './tool-error.ts';

import { getErrorMessage } from '../util/errors.ts';
import { type Config } from '../config/config.ts';
import { getResponseText } from '../util/partUtils.ts';
import { debugLogger } from '../util/debugLogger.ts';

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string;
}

interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

/**
 * Parameters for the WebSearchTool.
 */
export interface WebSearchToolParams {
  query: string;
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface WebSearchToolResult extends ToolResult {
  sources?: GroundingMetadata extends { groundingChunks: GroundingChunkItem[] }
  ? GroundingMetadata['groundingChunks']
  : GroundingChunkItem[];
}

class WebSearchToolInvocation extends BaseToolInvocation<
  WebSearchToolParams,
  WebSearchToolResult
> {
  private static readonly cache = new Map<string, any>();

  constructor(
    private readonly config: Config,
    params: WebSearchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
    _workspaceRoots?: readonly string[],
  ) {
    super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
  }

  override getDescription(): string {
    return `Searching the web for: "${this.params.query}"`;
  }

  async execute(signal: AbortSignal): Promise<WebSearchToolResult> {
    const cacheKey = JSON.stringify({
      query: this.params.query,
    });

    const cachedResult = WebSearchToolInvocation.cache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < 300000) {
      return {
        llmContent: cachedResult.llmContent,
        returnDisplay: `Cached search results for "${this.params.query}"`,
        sources: cachedResult.sources,
      };
    }

    const geminiClient = this.config.getGeminiClient();

    try {
      const response = await geminiClient.generateContent(
        { model: 'web-search' },
        [
          {
            role: 'user',
            parts: [{ text: this.params.query }],
          },
        ],
        signal,
      );

      const responseText = getResponseText(response);
      const groundingMetadata = (response.candidates?.[0]?.groundingMetadata as any) || {};
      const sources = groundingMetadata.groundingChunks || [];

      const result: WebSearchToolResult = {
        llmContent: responseText || 'No information found.',
        returnDisplay: `Web search completed for "${this.params.query}"`,
        sources,
      };

      WebSearchToolInvocation.cache.set(cacheKey, {
        llmContent: result.llmContent,
        sources: result.sources,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Web search failed: ${errorMessage}`,
        returnDisplay: `Error: Web search failed.`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }
  }
}

export class WebSearchTool extends BaseDeclarativeTool<WebSearchToolParams, WebSearchToolResult> {
  static readonly Name = WEB_SEARCH_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      WebSearchTool.Name,
      'WebSearch',
      'Searches the web using Google Search.',
      Kind.Search,
      {
        properties: {
          query: {
            description: 'The search query.',
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
      messageBus,
      true,
      false,
    );
  }

  protected createInvocation(
    params: WebSearchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
  ): ToolInvocation<WebSearchToolParams, WebSearchToolResult> {
    return new WebSearchToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
      _kind,
      this.config.getWorkspaceContext().getDirectories(),
    );
  }
}
