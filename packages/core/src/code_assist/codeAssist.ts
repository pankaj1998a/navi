/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGenerator } from '../core/contentGenerator.ts';
import { AuthType } from '../core/contentGenerator.ts';
import { getOauthClient } from './oauth2.ts';
import { setupUser } from './setup.ts';
import type { HttpOptions } from './server.ts';
import { CodeAssistServer } from './server.ts';
import type { Config } from '../config/config.ts';
import { LoggingContentGenerator } from '../core/loggingContentGenerator.ts';

export async function createCodeAssistContentGenerator(
  httpOptions: HttpOptions,
  authType: AuthType,
  config: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  if (
    authType === AuthType.LOGIN_WITH_GOOGLE ||
    authType === AuthType.COMPUTE_ADC
  ) {
    const authClient = await getOauthClient(authType, config);
    const userData = await setupUser(authClient);
    return new CodeAssistServer(
      authClient,
      userData.projectId,
      httpOptions,
      sessionId,
      userData.userTier,
    );
  }

  throw new Error(`Unsupported authType: ${authType}`);
}

export function getCodeAssistServer(
  config: Config,
): CodeAssistServer | undefined {
  let server = config.getContentGenerator();

  // Unwrap LoggingContentGenerator if present
  if (server instanceof LoggingContentGenerator) {
    server = server.getWrapped();
  }

  if (!(server instanceof CodeAssistServer)) {
    return undefined;
  }
  return server;
}
