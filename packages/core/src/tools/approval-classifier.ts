/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { Kind } from './tools.ts';

export type ApprovalClass =
  | 'readonly_scoped'
  | 'readonly_search'
  | 'mutating'
  | 'exec_capable'
  | 'control_plane'
  | 'think'
  | 'other'
  | 'unknown';

export interface ApprovalClassification {
  approvalClass: ApprovalClass;
  autoApprove: boolean;
}

const SAFE_SEARCH_TOOL_NAMES = new Set([
  'tavily_search',
  'exa_search',
  'duckduckgo_search',
  'web_search',
  'memory_search',
  'google_web_search',
]);

const EXEC_CAPABLE_TOOL_NAMES = new Set([
  'shell',
  'run_command',
  'terminal',
  'exec',
  'spawn',
]);

const CONTROL_PLANE_TOOL_NAMES = new Set([
  'sessions_spawn',
  'sessions_send',
  'activate_skill',
]);

/**
 * Classifies a tool call to determine if it can be automatically approved.
 */
export function classifyToolApproval(params: {
  toolName: string;
  kind: Kind;
  args: Record<string, unknown>;
  workspaceRoots: readonly string[];
}): ApprovalClassification {
  const { toolName, kind, args, workspaceRoots } = params;

  // 1. Thinking is always safe
  if (kind === Kind.Think || toolName === 'think') {
    return { approvalClass: 'think', autoApprove: true };
  }

  // 2. Search tools are generally safe
  if (kind === Kind.Search || SAFE_SEARCH_TOOL_NAMES.has(toolName)) {
    return { approvalClass: 'readonly_search', autoApprove: true };
  }

  // 3. Read tools are safe if scoped to the workspace
  if (kind === Kind.Read || toolName === 'read_file' || toolName === 'ls' || toolName === 'glob') {
    const isScoped = isPathScopedToWorkspace(args, workspaceRoots);
    return {
      approvalClass: isScoped ? 'readonly_scoped' : 'other',
      autoApprove: isScoped,
    };
  }

  // 4. Critical tools that always require confirmation
  if (kind === Kind.Execute || EXEC_CAPABLE_TOOL_NAMES.has(toolName)) {
    return { approvalClass: 'exec_capable', autoApprove: false };
  }

  // 5. Control plane tools
  if (CONTROL_PLANE_TOOL_NAMES.has(toolName)) {
    return { approvalClass: 'control_plane', autoApprove: false };
  }

  // 6. Mutating tools (Kind.Edit or matches naming patterns)
  if (
    kind === Kind.Edit ||
    kind === Kind.Delete ||
    kind === Kind.Move ||
    toolName.includes('write') ||
    toolName.includes('edit') ||
    toolName.includes('replace') ||
    toolName.includes('patch')
  ) {
    return { approvalClass: 'mutating', autoApprove: false };
  }

  return { approvalClass: 'other', autoApprove: false };
}

function isPathScopedToWorkspace(
  args: Record<string, unknown>,
  workspaceRoots: readonly string[],
): boolean {
  const pathValue = args.path ?? args.file_path ?? args.dir_path ?? args.filePath ?? args.directory;
  if (typeof pathValue !== 'string') {
    // If no path is provided, we default to false for safety
    return false;
  }

  const absolutePath = path.isAbsolute(pathValue)
    ? path.normalize(pathValue)
    : undefined;

  // If we can't determine an absolute path, we can't verify scope reliably.
  if (!absolutePath) {
    // Relative paths are typically safe as they're resolved against CWD (usually workspace root in Navi)
    // but the safest approach is to ensure they don't use '..' to escape.
    return !pathValue.split(path.sep).includes('..');
  }

  return workspaceRoots.some((root) => {
    const normalizedRoot = path.normalize(root);
    const relative = path.relative(normalizedRoot, absolutePath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  });
}
