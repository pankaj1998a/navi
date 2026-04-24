/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Fast File Tool - optimized file operations for agents.
 * 
 * Provides:
 * - Batched file reads
 * - Concurrent file operations
 * - Streaming writes
 * - Cached file access
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
    BaseDeclarativeTool,
    Kind,
    type ToolInvocation,
    type ToolResult,
    BaseToolInvocation,
} from '../index.ts'
import type { AnsiOutput } from '../index.ts'
import type { MessageBus } from '../index.ts'
import { debugLogger } from 'navi-ai-agent/utils/debugLogger'
import * as fs from 'fs/promises';
import * as path from 'path';

const FAST_READ_TOOL_NAME = 'fast_read_files';
const FAST_WRITE_TOOL_NAME = 'fast_write_files';

/** Schema for fast read tool */
const FastReadSchema = z.object({
    paths: z.array(z.string()).min(1).max(20).describe('File paths to read (max 20)'),
    max_chars_per_file: z.number().optional().default(10000).describe('Max characters per file'),
});

/** Schema for fast write tool */
const FastWriteSchema = z.object({
    files: z.array(z.object({
        path: z.string().describe('File path to write'),
        content: z.string().describe('Content to write'),
    })).min(1).max(10).describe('Files to write (max 10)'),
    create_dirs: z.boolean().optional().default(true).describe('Create directories if needed'),
});

type FastReadParams = z.infer<typeof FastReadSchema>;
type FastWriteParams = z.infer<typeof FastWriteSchema>;

/** Result of a single file read */
interface FileReadResult {
    path: string;
    success: boolean;
    content?: string;
    error?: string;
    size?: number;
    truncated?: boolean;
}

/** Result of a single file write */
interface FileWriteResult {
    path: string;
    success: boolean;
    error?: string;
    bytesWritten?: number;
}

/**
 * Fast Read Files Tool - reads multiple files in parallel.
 */
export class FastReadFilesTool extends BaseDeclarativeTool<
    FastReadParams,
    ToolResult
> {
    constructor(messageBus: MessageBus) {
        super(
            FAST_READ_TOOL_NAME,
            'Fast Read Files',
            'Read multiple files in parallel with a single tool call. More efficient than reading files one at a time.',
            Kind.Read,
            zodToJsonSchema(FastReadSchema),
            messageBus,
      /* isOutputMarkdown */ true,
      /* canUpdateOutput */ false,
        );
    }

    protected createInvocation(
        params: FastReadParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ): ToolInvocation<FastReadParams, ToolResult> {
        return new FastReadInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
        );
    }
}

class FastReadInvocation extends BaseToolInvocation<
    FastReadParams,
    ToolResult
> {
    constructor(
        params: FastReadParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ) {
        super(
            params,
            messageBus,
            _toolName ?? FAST_READ_TOOL_NAME,
            _toolDisplayName,
        );
    }

    getDescription(): string {
        return `Reading ${this.params.paths.length} files in parallel`;
    }

    async execute(
        signal: AbortSignal,
        updateOutput?: (output: string | AnsiOutput) => void,
    ): Promise<ToolResult> {
        const maxChars = this.params.max_chars_per_file ?? 10000;
        const startTime = Date.now();

        // Read all files in parallel
        const results = await Promise.allSettled(
            this.params.paths.map(filePath => this.readFile(filePath, maxChars))
        );

        const fileResults: FileReadResult[] = results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }
            return {
                path: this.params.paths[index],
                success: false,
                error: result.reason?.message ?? 'Unknown error',
            };
        });

        const duration = Date.now() - startTime;
        const successCount = fileResults.filter(r => r.success).length;

        debugLogger.log(`[FastRead] Read ${successCount}/${fileResults.length} files in ${duration}ms`);

        return this.formatResult(fileResults, duration);
    }

    private async readFile(filePath: string, maxChars: number): Promise<FileReadResult> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const truncated = content.length > maxChars;
            return {
                path: filePath,
                success: true,
                content: truncated ? content.slice(0, maxChars) + '\n... (truncated)' : content,
                size: content.length,
                truncated,
            };
        } catch (error) {
            return {
                path: filePath,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private formatResult(results: FileReadResult[], durationMs: number): ToolResult {
        const lines: string[] = [
            `# Fast Read Results`,
            `Read ${results.filter(r => r.success).length}/${results.length} files in ${durationMs}ms`,
            '',
        ];

        for (const result of results) {
            if (result.success) {
                lines.push(`## ${path.basename(result.path)}`);
                lines.push(`Path: \`${result.path}\``);
                if (result.truncated) {
                    lines.push(`*Truncated from ${result.size} chars*`);
                }
                lines.push('```');
                lines.push(result.content ?? '');
                lines.push('```');
                lines.push('');
            } else {
                lines.push(`## ❌ ${path.basename(result.path)}`);
                lines.push(`Error: ${result.error}`);
                lines.push('');
            }
        }

        const content = lines.join('\n');
        return {
            llmContent: [{ text: content }],
            returnDisplay: content,
        };
    }
}

/**
 * Fast Write Files Tool - writes multiple files in parallel.
 */
export class FastWriteFilesTool extends BaseDeclarativeTool<
    FastWriteParams,
    ToolResult
> {
    constructor(messageBus: MessageBus) {
        super(
            FAST_WRITE_TOOL_NAME,
            'Fast Write Files',
            'Write multiple files in parallel with a single tool call. Creates directories as needed.',
            Kind.Edit,
            zodToJsonSchema(FastWriteSchema),
            messageBus,
      /* isOutputMarkdown */ true,
      /* canUpdateOutput */ false,
        );
    }

    protected createInvocation(
        params: FastWriteParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ): ToolInvocation<FastWriteParams, ToolResult> {
        return new FastWriteInvocation(
            params,
            messageBus,
            _toolName,
            _toolDisplayName,
        );
    }
}

class FastWriteInvocation extends BaseToolInvocation<
    FastWriteParams,
    ToolResult
> {
    constructor(
        params: FastWriteParams,
        messageBus: MessageBus,
        _toolName?: string,
        _toolDisplayName?: string,
    ) {
        super(
            params,
            messageBus,
            _toolName ?? FAST_WRITE_TOOL_NAME,
            _toolDisplayName,
        );
    }

    getDescription(): string {
        return `Writing ${this.params.files.length} files in parallel`;
    }

    async execute(
        signal: AbortSignal,
        updateOutput?: (output: string | AnsiOutput) => void,
    ): Promise<ToolResult> {
        const createDirs = this.params.create_dirs ?? true;
        const startTime = Date.now();

        // Write all files in parallel
        const results = await Promise.allSettled(
            this.params.files.map(file => this.writeFile(file.path, file.content, createDirs))
        );

        const fileResults: FileWriteResult[] = results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }
            return {
                path: this.params.files[index].path,
                success: false,
                error: result.reason?.message ?? 'Unknown error',
            };
        });

        const duration = Date.now() - startTime;
        const successCount = fileResults.filter(r => r.success).length;

        debugLogger.log(`[FastWrite] Wrote ${successCount}/${fileResults.length} files in ${duration}ms`);

        return this.formatResult(fileResults, duration);
    }

    private async writeFile(
        filePath: string,
        content: string,
        createDirs: boolean,
    ): Promise<FileWriteResult> {
        try {
            if (createDirs) {
                const dir = path.dirname(filePath);
                await fs.mkdir(dir, { recursive: true });
            }

            await fs.writeFile(filePath, content, 'utf-8');
            return {
                path: filePath,
                success: true,
                bytesWritten: content.length,
            };
        } catch (error) {
            return {
                path: filePath,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    private formatResult(results: FileWriteResult[], durationMs: number): ToolResult {
        const lines: string[] = [
            `# Fast Write Results`,
            `Wrote ${results.filter(r => r.success).length}/${results.length} files in ${durationMs}ms`,
            '',
        ];

        for (const result of results) {
            if (result.success) {
                lines.push(`✅ \`${result.path}\` (${result.bytesWritten} bytes)`);
            } else {
                lines.push(`❌ \`${result.path}\`: ${result.error}`);
            }
        }

        const content = lines.join('\n');
        return {
            llmContent: [{ text: content }],
            returnDisplay: content,
        };
    }
}

