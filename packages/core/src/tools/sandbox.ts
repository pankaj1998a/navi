/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, BaseToolInvocation, Kind, type ToolInvocation, type ToolResult } from './tools.ts';
import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { ToolErrorType } from './tool-error.ts';
import { debugLogger } from '../util/debugLogger.ts';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

export interface CodeSandboxToolParams {
  language: 'python' | 'bash' | 'node';
  code: string;
}

export interface CodeSandboxToolResult extends ToolResult {}

class CodeSandboxToolInvocation extends BaseToolInvocation<CodeSandboxToolParams, CodeSandboxToolResult> {
  constructor(
    params: CodeSandboxToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
    _workspaceRoots?: readonly string[],
  ) {
    super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
  }

  async execute(signal: AbortSignal): Promise<CodeSandboxToolResult> {
    const sandboxId = uuidv4();
    const tempDir = path.join(os.tmpdir(), `navi-sandbox-${sandboxId}`);

    try {
      await fs.mkdir(tempDir, { recursive: true });

      const ext = this.params.language === 'python' ? 'py' : this.params.language === 'node' ? 'js' : 'sh';
      const entrypoint = this.params.language === 'python' ? 'python3' : this.params.language === 'node' ? 'node' : 'bash';
      const tempFile = path.join(tempDir, `script.${ext}`);

      await fs.writeFile(tempFile, this.params.code, 'utf8');

      // Note: We assume that the user has built the Docker container named 'navi-sandbox'.
      // A background fallback could build it if it doesn't exist, but for now we expect it to exist.
      // Also, Windows Docker paths sometimes need formatting, but `-v` should handle standard absolute paths in modern Docker.
      
      const dockerCmd = `docker run --rm -v "${tempDir}:/workspace" -w /workspace navi-sandbox ${entrypoint} /workspace/script.${ext}`;
      
      let resultOutput = '';
      try {
        const { stdout, stderr } = await execAsync(dockerCmd, { timeout: 30000 }); // 30s timeout
        resultOutput = stdout + (stderr ? `\nErrors:\n${stderr}` : '');
      } catch (cmdErr: any) {
         resultOutput = cmdErr.stdout + (cmdErr.stderr ? `\nErrors:\n${cmdErr.stderr}` : '') + `\nCommand Failed: ${cmdErr.message}`;
      }

      return {
        llmContent: `Code executed in sandbox.\nOutput:\n${resultOutput}`,
        returnDisplay: `Executed ${this.params.language} code in sandbox.`,
      };
    } catch (e: any) {
      debugLogger.error('Sandbox execution failed', e);
      return {
        llmContent: `Error: ${e.message}`,
        returnDisplay: `Sandbox execution failed.`,
        error: { message: e.message, type: ToolErrorType.UNKNOWN }
      };
    } finally {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (_) {}
    }
  }

  override getDescription(): string {
    return `Executing ${this.params.language} code in secure docker sandbox`;
  }
}

export class CodeSandboxTool extends BaseDeclarativeTool<CodeSandboxToolParams, CodeSandboxToolResult> {
  static readonly Name = 'sandbox';
  constructor(messageBus: MessageBus) {
    super(
      CodeSandboxTool.Name,
      'Code Sandbox',
      'Execute isolated test code, data analysis, or shell scripts in a secure, containerized docker environment without modifying the host machine. Use this to safely test code or perform complex logic.',
      Kind.Execute,
      {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['python', 'bash', 'node'] },
          code: { type: 'string', description: 'The code snippet to run' }
        },
        required: ['language', 'code']
      },
      messageBus
    );
  }

  protected createInvocation(
    params: CodeSandboxToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
  ): ToolInvocation<CodeSandboxToolParams, CodeSandboxToolResult> {
    return new CodeSandboxToolInvocation(
      params,
      messageBus,
      _toolName ?? this.name,
      _toolDisplayName ?? this.displayName,
      _kind,
      [], // Sandbox is off-disk (mount point is temp)
    );
  }
}
