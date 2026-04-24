/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ToolInvocation, ToolResult } from './tools.ts';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.ts';
import { SchemaValidator } from '../util/schemaValidator.ts';
import { makeRelative, shortenPath } from '../util/paths.ts';
import { getErrorMessage, isNodeError } from '../util/errors.ts';
import type { Config } from '../config/config.ts';
import { fileExists } from '../util/fileUtils.ts';
import { Storage } from '../config/storage.ts';
import { GREP_TOOL_NAME } from './tool-names.ts';
import { debugLogger } from '../util/debugLogger.ts';
import {
  FileExclusions,
  COMMON_DIRECTORY_EXCLUDES,
} from '../util/ignorePatterns.ts';
import { GeminiIgnoreParser } from '../util/geminiIgnoreParser.ts';

const DEFAULT_TOTAL_MAX_MATCHES = 20000;

function getRgCandidateFilenames(): readonly string[] {
  return process.platform === 'win32' ? ['rg.exe', 'rg'] : ['rg'];
}

async function resolveExistingRgPath(): Promise<string | null> {
  const binDir = Storage.getGlobalBinDir();
  for (const fileName of getRgCandidateFilenames()) {
    const candidatePath = path.join(binDir, fileName);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

async function ensureRipgrepAvailable(): Promise<string | null> {
  const existingPath = await resolveExistingRgPath();
  if (existingPath) {
    return existingPath;
  }
  return 'rg';
}

export async function canUseRipgrep(): Promise<boolean> {
  return (await ensureRipgrepAvailable()) !== null;
}

export async function ensureRgPath(): Promise<string> {
  const downloadedPath = await ensureRipgrepAvailable();
  if (downloadedPath) {
    return downloadedPath;
  }
  throw new Error('Cannot use ripgrep.');
}

function resolveAndValidatePath(
  config: Config,
  relativePath?: string,
): string | null {
  if (!relativePath) {
    return null;
  }

  const targetDir = config.getTargetDir();
  const targetPath = path.resolve(targetDir, relativePath);

  const workspaceContext = config.getWorkspaceContext();
  if (!workspaceContext.isPathWithinWorkspace(targetPath)) {
    const directories = workspaceContext.getDirectories();
    throw new Error(
      `Path validation failed: Attempted path "${relativePath}" resolves outside the allowed workspace directories: ${directories.join(', ')}`,
    );
  }

  try {
    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new Error(
        `Path is not a valid directory or file: ${targetPath} (CWD: ${targetDir})`,
      );
    }
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(`Path does not exist: ${targetPath} (CWD: ${targetDir})`);
    }
    throw new Error(`Failed to access path stats for ${targetPath}: ${error}`);
  }

  return targetPath;
}

export interface RipGrepToolParams {
  pattern: string;
  dir_path?: string;
  include?: string;
  case_sensitive?: boolean;
  fixed_strings?: boolean;
  context?: number;
  after?: number;
  before?: number;
  no_ignore?: boolean;
}

interface GrepMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

class GrepToolInvocation extends BaseToolInvocation<
  RipGrepToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    private readonly geminiIgnoreParser: GeminiIgnoreParser,
    params: RipGrepToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
    _workspaceRoots?: readonly string[],
  ) {
    super(params, messageBus, _toolName, _toolDisplayName, undefined, _kind, _workspaceRoots);
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      const pathParam = this.params.dir_path || '.';
      const searchDirAbs = resolveAndValidatePath(this.config, pathParam);
      const searchDirDisplay = pathParam;

      const totalMaxMatches = DEFAULT_TOTAL_MAX_MATCHES;
      if (this.config.getDebugMode()) {
        debugLogger.log(`[GrepTool] Total result limit: ${totalMaxMatches}`);
      }

      let allMatches = await this.performRipgrepSearch({
        pattern: this.params.pattern,
        path: searchDirAbs!,
        include: this.params.include,
        case_sensitive: this.params.case_sensitive,
        fixed_strings: this.params.fixed_strings,
        context: this.params.context,
        after: this.params.after,
        before: this.params.before,
        no_ignore: this.params.no_ignore,
        signal,
      });

      if (allMatches.length >= totalMaxMatches) {
        allMatches = allMatches.slice(0, totalMaxMatches);
      }

      const searchLocationDescription = `in path "${searchDirDisplay}"`;
      if (allMatches.length === 0) {
        const noMatchMsg = `No matches found for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}.`;
        return { llmContent: noMatchMsg, returnDisplay: `No matches found` };
      }

      const wasTruncated = allMatches.length >= totalMaxMatches;

      const matchesByFile = allMatches.reduce(
        (acc, match) => {
          const fileKey = match.filePath;
          if (!acc[fileKey]) {
            acc[fileKey] = [];
          }
          acc[fileKey].push(match);
          acc[fileKey].sort((a, b) => a.lineNumber - b.lineNumber);
          return acc;
        },
        {} as Record<string, GrepMatch[]>,
      );

      const matchCount = allMatches.length;
      const matchTerm = matchCount === 1 ? 'match' : 'matches';

      let llmContent = `Found ${matchCount} ${matchTerm} for pattern "${this.params.pattern}" ${searchLocationDescription}${this.params.include ? ` (filter: "${this.params.include}")` : ''}`;

      if (wasTruncated) {
        llmContent += ` (results limited to ${totalMaxMatches} matches for performance)`;
      }

      llmContent += `:\n---\n`;

      for (const filePath in matchesByFile) {
        llmContent += `File: ${filePath}\n`;
        matchesByFile[filePath].forEach((match) => {
          const trimmedLine = match.line.trim();
          llmContent += `L${match.lineNumber}: ${trimmedLine}\n`;
        });
        llmContent += '---\n';
      }

      let displayMessage = `Found ${matchCount} ${matchTerm}`;
      if (wasTruncated) {
        displayMessage += ` (limited)`;
      }

      return {
        llmContent: llmContent.trim(),
        returnDisplay: displayMessage,
      };
    } catch (error) {
      debugLogger.warn(`Error during GrepLogic execution: ${error}`);
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Error during grep search operation: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }

  private parseRipgrepJsonOutput(
    output: string,
    basePath: string,
  ): GrepMatch[] {
    const results: GrepMatch[] = [];
    if (!output) return results;

    const lines = output.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const json = JSON.parse(line);
        if (json.type === 'match') {
          const match = json.data;
          if (match.path?.text && match.lines?.text) {
            const absoluteFilePath = path.resolve(basePath, match.path.text);
            const relativeFilePath = path.relative(basePath, absoluteFilePath);

            results.push({
              filePath: relativeFilePath || path.basename(absoluteFilePath),
              lineNumber: match.line_number,
              line: match.lines.text.trimEnd(),
            });
          }
        }
      } catch (error) {
        debugLogger.warn(`Failed to parse ripgrep JSON line: ${line}`, error);
      }
    }
    return results;
  }

  private async performRipgrepSearch(options: {
    pattern: string;
    path: string;
    include?: string;
    case_sensitive?: boolean;
    fixed_strings?: boolean;
    context?: number;
    after?: number;
    before?: number;
    no_ignore?: boolean;
    signal: AbortSignal;
  }): Promise<GrepMatch[]> {
    const {
      pattern,
      path: absolutePath,
      include,
      case_sensitive,
      fixed_strings,
      context,
      after,
      before,
      no_ignore,
    } = options;

    const rgArgs = ['--json'];

    if (!case_sensitive) {
      rgArgs.push('--ignore-case');
    }

    if (fixed_strings) {
      rgArgs.push('--fixed-strings', pattern);
    } else {
      rgArgs.push('--regexp', pattern);
    }

    if (context) rgArgs.push('--context', context.toString());
    if (after) rgArgs.push('--after-context', after.toString());
    if (before) rgArgs.push('--before-context', before.toString());
    if (no_ignore) rgArgs.push('--no-ignore');
    if (include) rgArgs.push('--glob', include);

    if (!no_ignore) {
      const fileExclusions = new FileExclusions(this.config);
      const excludes = fileExclusions.getGlobExcludes([
        ...COMMON_DIRECTORY_EXCLUDES,
        '*.log',
        '*.tmp',
      ]);
      excludes.forEach((exclude) => {
        rgArgs.push('--glob', `!${exclude}`);
      });

      if (this.config.getFileFilteringRespectGeminiIgnore()) {
        const geminiIgnorePath = this.geminiIgnoreParser.getIgnoreFilePath();
        if (geminiIgnorePath) {
          rgArgs.push('--ignore-file', geminiIgnorePath);
        }
      }
    }

    rgArgs.push('--threads', '4');
    rgArgs.push(absolutePath);

    try {
      const rgPath = await ensureRgPath();
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(rgPath, rgArgs, { windowsHide: true });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        const cleanup = () => {
          if (options.signal.aborted) child.kill();
        };

        options.signal.addEventListener('abort', cleanup, { once: true });
        child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

        child.on('error', (err) => {
          options.signal.removeEventListener('abort', cleanup);
          reject(new Error(`Failed to start ripgrep: ${err.message}`));
        });

        child.on('close', (code) => {
          options.signal.removeEventListener('abort', cleanup);
          if (code === 0) resolve(Buffer.concat(stdoutChunks).toString('utf8'));
          else if (code === 1) resolve('');
          else reject(new Error(`ripgrep exited with code ${code}: ${Buffer.concat(stderrChunks).toString('utf8')}`));
        });
      });

      return this.parseRipgrepJsonOutput(output, absolutePath);
    } catch (error: unknown) {
      debugLogger.debug(`GrepLogic: ripgrep failed: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  getDescription(): string {
    let description = `'${this.params.pattern}'`;
    if (this.params.include) description += ` in ${this.params.include}`;
    const pathParam = this.params.dir_path || '.';
    const resolvedPath = path.resolve(this.config.getTargetDir(), pathParam);
    if (resolvedPath === this.config.getTargetDir() || pathParam === '.') {
      description += ` within ./`;
    } else {
      const relativePath = makeRelative(resolvedPath, this.config.getTargetDir());
      description += ` within ${shortenPath(relativePath)}`;
    }
    return description;
  }
}

export class RipGrepTool extends BaseDeclarativeTool<
  RipGrepToolParams,
  ToolResult
> {
  static readonly Name = GREP_TOOL_NAME;
  private readonly geminiIgnoreParser: GeminiIgnoreParser;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      RipGrepTool.Name,
      'SearchText',
      'FAST search powered by ripgrep.',
      Kind.Search,
      {
        properties: {
          pattern: { type: 'string' },
          dir_path: { type: 'string' },
          include: { type: 'string' },
          case_sensitive: { type: 'boolean' },
          fixed_strings: { type: 'boolean' },
          context: { type: 'integer' },
          after: { type: 'integer' },
          before: { type: 'integer' },
          no_ignore: { type: 'boolean' },
        },
        required: ['pattern'],
        type: 'object',
      },
      messageBus,
      true,
      false,
    );
    this.geminiIgnoreParser = new GeminiIgnoreParser(config.getTargetDir());
  }

  protected createInvocation(
    params: RipGrepToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
    _kind?: Kind,
  ): ToolInvocation<RipGrepToolParams, ToolResult> {
    return new GrepToolInvocation(
      this.config,
      this.geminiIgnoreParser,
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
      _kind,
      this.config.getWorkspaceContext().getDirectories(),
    );
  }
}
