/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ToolCallConfirmationDetails,
  ToolInvocation,
  ToolResult,
} from './tools.ts';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolConfirmationOutcome,
} from './tools.ts';
import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { ToolErrorType } from './tool-error.ts';
import { getErrorMessage } from '../util/errors.ts';
import type { Config } from '../config/config.ts';
import { ApprovalMode } from '../policy/types.ts';
import { getResponseText } from '../util/partUtils.ts';
import { fetchWithTimeout, isPrivateIp } from '../util/fetch.ts';
import { convert } from 'html-to-text';
import {
  logWebFetchFallbackAttempt,
  WebFetchFallbackAttemptEvent,
} from '../telemetry/index.ts';
import { WEB_FETCH_TOOL_NAME } from './tool-names.ts';
import { debugLogger } from '../util/debugLogger.ts';
import { retryWithBackoff } from '../util/retry.ts';

const DEFAULT_URL_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_MAX_CONTENT_LENGTH = 100000;

/**
 * Parses a prompt to extract valid URLs and identify malformed ones.
 */
export function parsePrompt(text: string): {
  validUrls: string[];
  errors: string[];
} {
  const tokens = text.split(/\s+/);
  const validUrls: string[] = [];
  const errors: string[] = [];

  for (const token of tokens) {
    if (!token) continue;

    if (token.includes('://')) {
      try {
        const url = new URL(token);
        if (['http:', 'https:'].includes(url.protocol)) {
          validUrls.push(url.href);
        } else {
          errors.push(
            `Unsupported protocol in URL: "${token}". Only http and https are supported.`,
          );
        }
      } catch (_) {
        errors.push(`Malformed URL detected: "${token}".`);
      }
    }
  }

  return { validUrls, errors };
}

// Interfaces for grounding metadata
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
}

/**
 * Parameters for the WebFetch tool
 */
export interface WebFetchToolParams {
  prompt: string;
}

interface ErrorWithStatus extends Error {
  status?: number;
}

class WebFetchToolInvocation extends BaseToolInvocation<
  WebFetchToolParams,
  ToolResult
> {
  private static readonly cache = new Map<string, any>();

  constructor(
    private readonly config: Config,
    params: WebFetchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
    _workspaceRoots?: readonly string[],
  ) {
    super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
  }

  private async fetchUrlWithRetry(url: string, signal: AbortSignal): Promise<string> {
    const timeout = this.config.getUrlFetchTimeout?.() ?? DEFAULT_URL_FETCH_TIMEOUT_MS;
    const maxContentLength = this.config.getMaxContentLength?.() ?? DEFAULT_MAX_CONTENT_LENGTH;

    const response = await retryWithBackoff(
      async () => {
        const res = await fetchWithTimeout(url, timeout, signal);
        if (!res.ok) {
          const error = new Error(
            `Request failed with status code ${res.status} ${res.statusText}`,
          );
          (error as ErrorWithStatus).status = res.status;
          throw error;
        }
        return res;
      },
      {
        retryFetchErrors: this.config.getRetryFetchErrors(),
      },
    );

    const rawContent = await response.text();
    const contentType = response.headers.get('content-type') || '';
    let textContent: string;

    if (
      contentType.toLowerCase().includes('text/html') ||
      contentType === ''
    ) {
      textContent = convert(rawContent, {
        wordwrap: false,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
        ],
      });
    } else {
      textContent = rawContent;
    }

    return textContent.substring(0, maxContentLength);
  }

  private async executeFallback(signal: AbortSignal): Promise<ToolResult> {
    const { validUrls: urls } = parsePrompt(this.params.prompt);

    const fetchPromises = urls.map(async (originalUrl) => {
      let url = originalUrl;
      if (url.includes('github.com') && url.includes('/blob/')) {
        url = url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      }

      try {
        const content = await this.fetchUrlWithRetry(url, signal);
        return { url: originalUrl, content, error: null };
      } catch (error) {
        return {
          url: originalUrl,
          content: null,
          error: `Error fetching ${originalUrl}: ${(error as Error).message}`
        };
      }
    });

    const results = await Promise.all(fetchPromises);

    const successfulResults = results.filter(result => result.error === null && result.content);
    const errorResults = results.filter(result => result.error !== null);

    if (successfulResults.length === 0) {
      const errorMessages = errorResults.map(result => result.error).join('\n');
      return {
        llmContent: `Error: ${errorMessages}`,
        returnDisplay: `Error fetching URLs: ${errorResults.length} failed`,
        error: {
          message: errorMessages,
          type: ToolErrorType.WEB_FETCH_FALLBACK_FAILED,
        },
      };
    }

    if (successfulResults.length === 1) {
      const result = successfulResults[0];
      const geminiClient = this.config.getGeminiClient();
      const fallbackPrompt = `The user requested the following: "${this.params.prompt}".

I was unable to access the URL directly. Instead, I have fetched the raw content of the page. Please use the following content to answer the request. Do not attempt to access the URL again.

---
${result.content}
---
`;
      const geminiResult = await geminiClient.generateContent(
        { model: 'web-fetch-fallback' },
        [{ role: 'user', parts: [{ text: fallbackPrompt }] }],
        signal,
      );
      const resultText = getResponseText(geminiResult) || '';
      return {
        llmContent: resultText,
        returnDisplay: `Content for ${result.url} processed using fallback fetch.`,
      };
    }

    const combinedContent = successfulResults.map(result =>
      `---
URL: ${result.url}
---
${result.content}
`
    ).join('\n');

    const geminiClient = this.config.getGeminiClient();
    const fallbackPrompt = `The user requested the following: "${this.params.prompt}".

I was unable to access the URLs directly. Instead, I have fetched the raw content of the pages. Please use the following content to answer the request. Do not attempt to access the URLs again.

---
${combinedContent}
---
`;
    const geminiResult = await geminiClient.generateContent(
      { model: 'web-fetch-fallback' },
      [{ role: 'user', parts: [{ text: fallbackPrompt }] }],
      signal,
    );
    const resultText = getResponseText(geminiResult) || '';

    return {
      llmContent: resultText,
      returnDisplay: `Content for ${successfulResults.length} URLs processed using fallback fetch.`,
    };
  }

  getDescription(): string {
    const displayPrompt =
      this.params.prompt.length > 100
        ? this.params.prompt.substring(0, 97) + '...'
        : this.params.prompt;
    return `Processing URLs and instructions from prompt: "${displayPrompt}"`;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }

    const { validUrls } = parsePrompt(this.params.prompt);
    const urls = validUrls.map((url) => {
      if (url.includes('github.com') && url.includes('/blob/')) {
        return url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
      }
      return url;
    });

    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Confirm Web Fetch`,
      prompt: this.params.prompt,
      urls,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        } else {
          await this.publishPolicyUpdate(outcome);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const userPrompt = this.params.prompt;
    const { validUrls: urls } = parsePrompt(userPrompt);

    const cacheKey = JSON.stringify({
      prompt: userPrompt,
      urls: urls.sort(),
    });

    const cachedResult = WebFetchToolInvocation.cache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < 300000) {
      return {
        llmContent: cachedResult.llmContent,
        returnDisplay: `Cached content for ${urls.length} URL${urls.length > 1 ? 's' : ''}`,
      };
    }

    const hasPrivateUrls = urls.some(url => isPrivateIp(url));
    if (hasPrivateUrls) {
      logWebFetchFallbackAttempt(
        this.config,
        new WebFetchFallbackAttemptEvent('private_ip'),
      );
      return this.executeFallback(signal);
    }

    const geminiClient = this.config.getGeminiClient();

    try {
      const response = await geminiClient.generateContent(
        { model: 'web-fetch' },
        [{ role: 'user', parts: [{ text: userPrompt }] }],
        signal,
      );

      let responseText = getResponseText(response) || '';
      const urlContextMeta = response.candidates?.[0]?.urlContextMetadata;
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const sources = groundingMetadata?.groundingChunks as
        | GroundingChunkItem[]
        | undefined;
      const groundingSupports = groundingMetadata?.groundingSupports as
        | GroundingSupportItem[]
        | undefined;

      let processingError = false;

      if (
        urlContextMeta?.urlMetadata &&
        urlContextMeta.urlMetadata.length > 0
      ) {
        const allStatuses = urlContextMeta.urlMetadata.map(
          (m) => m.urlRetrievalStatus,
        );
        if (allStatuses.every((s) => s !== 'URL_RETRIEVAL_STATUS_SUCCESS')) {
          processingError = true;
        }
      } else if (!responseText.trim() && !sources?.length) {
        processingError = true;
      }

      if (
        !processingError &&
        !responseText.trim() &&
        (!sources || sources.length === 0)
      ) {
        processingError = true;
      }

      if (processingError) {
        logWebFetchFallbackAttempt(
          this.config,
          new WebFetchFallbackAttemptEvent('primary_failed'),
        );
        return await this.executeFallback(signal);
      }

      const sourceListFormatted: string[] = [];
      if (sources && sources.length > 0) {
        sources.forEach((source: GroundingChunkItem, index: number) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'Unknown URI';
          sourceListFormatted.push(`[${index + 1}] ${title} (${uri})`);
        });

        if (groundingSupports && groundingSupports.length > 0) {
          const insertions: Array<{ index: number; marker: string }> = [];
          groundingSupports.forEach((support: GroundingSupportItem) => {
            if (support.segment && support.groundingChunkIndices) {
              const citationMarker = support.groundingChunkIndices
                .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
                .join('');
              insertions.push({
                index: support.segment.endIndex,
                marker: citationMarker,
              });
            }
          });

          insertions.sort((a, b) => b.index - a.index);
          const responseChars = responseText.split('');
          insertions.forEach((insertion) => {
            responseChars.splice(insertion.index, 0, insertion.marker);
          });
          responseText = responseChars.join('');
        }

        if (sourceListFormatted.length > 0) {
          responseText += `\n\nSources:\n${sourceListFormatted.join('\n')}`;
        }
      }

      const llmContent = responseText;

      WebFetchToolInvocation.cache.set(cacheKey, {
        llmContent,
        timestamp: Date.now(),
      });

      const now = Date.now();
      for (const [key, value] of WebFetchToolInvocation.cache.entries()) {
        if (now - value.timestamp > 3600000) {
          WebFetchToolInvocation.cache.delete(key);
        }
      }

      return {
        llmContent,
        returnDisplay: `Content processed from ${urls.length} URL${urls.length > 1 ? 's' : ''}.`,
      };
    } catch (error: unknown) {
      const errorMessage = `Error processing web content for prompt "${userPrompt.substring(
        0,
        50,
      )}...": ${getErrorMessage(error)}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_FETCH_PROCESSING_ERROR,
        },
      };
    }
  }
}

export class WebFetchTool extends BaseDeclarativeTool<
  WebFetchToolParams,
  ToolResult
> {
  static readonly Name = WEB_FETCH_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      WebFetchTool.Name,
      'WebFetch',
      "Processes content from URL(s).",
      Kind.Fetch,
      {
        properties: {
          prompt: {
            description: 'A prompt with URLs and instructions.',
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
      messageBus,
      true,
      false,
    );
  }

  protected override validateToolParamValues(
    params: WebFetchToolParams,
  ): string | null {
    if (!params.prompt || params.prompt.trim() === '') {
      return "The 'prompt' parameter cannot be empty.";
    }
    const { validUrls, errors } = parsePrompt(params.prompt);
    if (errors.length > 0) {
      return `Error(s) in prompt URLs:\n- ${errors.join('\n- ')}`;
    }
    if (validUrls.length === 0) {
      return "The 'prompt' must contain at least one valid URL.";
    }
    return null;
  }

  protected createInvocation(
    params: WebFetchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
  ): ToolInvocation<WebFetchToolParams, ToolResult> {
    return new WebFetchToolInvocation(
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
