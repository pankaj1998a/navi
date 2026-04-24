/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthType } from '../core/contentGenerator.ts';
import { getOauthClient } from './oauth2.ts';
import { setupUser } from './setup.ts';
import { CodeAssistServer } from './server.ts';
import {
  createCodeAssistContentGenerator,
  getCodeAssistServer,
} from './codeAssist.ts';
import type { Config } from '../config/config.ts';
import { LoggingContentGenerator } from '../core/loggingContentGenerator.ts';
import { UserTierId } from './types.ts';

// Mock dependencies
vi.mock('./oauth2.ts');
vi.mock('./setup.ts');
vi.mock('./server.ts');
vi.mock('../core/loggingContentGenerator.ts');

const mockedGetOauthClient = vi.mocked(getOauthClient);
const mockedSetupUser = vi.mocked(setupUser);
const MockedCodeAssistServer = vi.mocked(CodeAssistServer);
const MockedLoggingContentGenerator = vi.mocked(LoggingContentGenerator);

describe('codeAssist', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createCodeAssistContentGenerator', () => {
    const httpOptions = {};
    const mockConfig = {} as Config;
    const mockAuthClient = { a: 'client' };
    const mockUserData = {
      projectId: 'test-project',
      userTier: UserTierId.FREE,
    };

    it('should create a server for LOGIN_WITH_GOOGLE', async () => {
      mockedGetOauthClient.mockResolvedValue(mockAuthClient as never);
      mockedSetupUser.mockResolvedValue(mockUserData);

      const generator = await createCodeAssistContentGenerator(
        httpOptions,
        AuthType.LOGIN_WITH_GOOGLE,
        mockConfig,
        'session-123',
      );

      expect(getOauthClient).toHaveBeenCalledWith(
        AuthType.LOGIN_WITH_GOOGLE,
        mockConfig,
      );
      expect(setupUser).toHaveBeenCalledWith(mockAuthClient);
      expect(MockedCodeAssistServer).toHaveBeenCalledWith(
        mockAuthClient,
        'test-project',
        httpOptions,
        'session-123',
        'free-tier',
      );
      expect(generator).toBeInstanceOf(MockedCodeAssistServer);
    });

    it('should create a server for COMPUTE_ADC', async () => {
      mockedGetOauthClient.mockResolvedValue(mockAuthClient as never);
      mockedSetupUser.mockResolvedValue(mockUserData);

      const generator = await createCodeAssistContentGenerator(
        httpOptions,
        AuthType.COMPUTE_ADC,
        mockConfig,
      );

      expect(getOauthClient).toHaveBeenCalledWith(
        AuthType.COMPUTE_ADC,
        mockConfig,
      );
      expect(setupUser).toHaveBeenCalledWith(mockAuthClient);
      expect(MockedCodeAssistServer).toHaveBeenCalledWith(
        mockAuthClient,
        'test-project',
        httpOptions,
        undefined, // No session ID
        'free-tier',
      );
      expect(generator).toBeInstanceOf(MockedCodeAssistServer);
    });

    it('should throw an error for unsupported auth types', async () => {
      await expect(
        createCodeAssistContentGenerator(
          httpOptions,
          'api-key' as AuthType, // Use literal string to avoid enum resolution issues
          mockConfig,
        ),
      ).rejects.toThrow('Unsupported authType: api-key');
    });
  });

  describe('getCodeAssistServer', () => {
    it('should return the server if it is a CodeAssistServer', () => {
      const mockServer = new MockedCodeAssistServer({} as never, '', {});
      const mockConfig = {
        getContentGenerator: () => mockServer,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBe(mockServer);
    });

    it('should unwrap and return the server if it is wrapped in a LoggingContentGenerator', () => {
      const mockServer = new MockedCodeAssistServer({} as never, '', {});
      const mockLogger = new MockedLoggingContentGenerator(
        {} as never,
        {} as never,
      );
      vi.spyOn(mockLogger, 'getWrapped').mockReturnValue(mockServer);

      const mockConfig = {
        getContentGenerator: () => mockLogger,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBe(mockServer);
      expect(mockLogger.getWrapped).toHaveBeenCalled();
    });

    it('should return undefined if the content generator is not a CodeAssistServer', () => {
      const mockGenerator = { a: 'generator' }; // Not a CodeAssistServer
      const mockConfig = {
        getContentGenerator: () => mockGenerator,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBeUndefined();
    });

    it('should return undefined if the wrapped generator is not a CodeAssistServer', () => {
      const mockGenerator = { a: 'generator' }; // Not a CodeAssistServer
      const mockLogger = new MockedLoggingContentGenerator(
        {} as never,
        {} as never,
      );
      vi.spyOn(mockLogger, 'getWrapped').mockReturnValue(
        mockGenerator as never,
      );

      const mockConfig = {
        getContentGenerator: () => mockLogger,
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBeUndefined();
    });
  });
});
