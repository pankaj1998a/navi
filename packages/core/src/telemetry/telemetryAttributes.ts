/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Attributes } from '@opentelemetry/api';
import type { Config } from '../config/config.ts';
import { InstallationManager } from '../util/installationManager.ts';
import { UserAccountManager } from '../util/userAccountManager.ts';

const userAccountManager = new UserAccountManager();
const installationManager = new InstallationManager();

export function getCommonAttributes(config: Config): Attributes {
  const email = userAccountManager.getCachedGoogleAccount();
  return {
    'session.id': config.getSessionId(),
    'installation.id': installationManager.getInstallationId(),
    interactive: config.isInteractive(),
    ...(email && { 'user.email': email }),
  };
}
