/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

import { Storage } from './storage.ts';
import { GEMINI_DIR } from '../util/paths.ts';

describe('Storage – getGlobalSettingsPath', () => {
  it('returns path to ~/.gemini/settings.tson', () => {
    const expected = path.join(os.homedir(), GEMINI_DIR, 'settings.tson');
    expect(Storage.getGlobalSettingsPath()).toBe(expected);
  });
});

describe('Storage – additional helpers', () => {
  const projectRoot = '/tmp/project';
  const storage = new Storage(projectRoot);

  it('getWorkspaceSettingsPath returns project/.gemini/settings.tson', () => {
    const expected = path.join(projectRoot, GEMINI_DIR, 'settings.tson');
    expect(storage.getWorkspaceSettingsPath()).toBe(expected);
  });

  it('getUserCommandsDir returns ~/.gemini/commands', () => {
    const expected = path.join(os.homedir(), GEMINI_DIR, 'commands');
    expect(Storage.getUserCommandsDir()).toBe(expected);
  });

  it('getProjectCommandsDir returns project/.gemini/commands', () => {
    const expected = path.join(projectRoot, GEMINI_DIR, 'commands');
    expect(storage.getProjectCommandsDir()).toBe(expected);
  });

  it('getUserSkillsDir returns ~/.gemini/skills', () => {
    const expected = path.join(os.homedir(), GEMINI_DIR, 'skills');
    expect(Storage.getUserSkillsDir()).toBe(expected);
  });

  it('getProjectSkillsDir returns project/.gemini/skills', () => {
    const expected = path.join(projectRoot, GEMINI_DIR, 'skills');
    expect(storage.getProjectSkillsDir()).toBe(expected);
  });

  it('getUserAgentsDir returns ~/.gemini/agents', () => {
    const expected = path.join(os.homedir(), GEMINI_DIR, 'agents');
    expect(Storage.getUserAgentsDir()).toBe(expected);
  });

  it('getProjectAgentsDir returns project/.gemini/agents', () => {
    const expected = path.join(projectRoot, GEMINI_DIR, 'agents');
    expect(storage.getProjectAgentsDir()).toBe(expected);
  });

  it('getMcpOAuthTokensPath returns ~/.gemini/mcp-oauth-tokens.tson', () => {
    const expected = path.join(
      os.homedir(),
      GEMINI_DIR,
      'mcp-oauth-tokens.tson',
    );
    expect(Storage.getMcpOAuthTokensPath()).toBe(expected);
  });

  it('getGlobalBinDir returns ~/.gemini/tmp/bin', () => {
    const expected = path.join(os.homedir(), GEMINI_DIR, 'tmp', 'bin');
    expect(Storage.getGlobalBinDir()).toBe(expected);
  });
});
