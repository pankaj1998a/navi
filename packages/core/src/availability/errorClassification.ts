/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  TerminalQuotaError,
  RetryableQuotaError,
} from '../util/googleQuotaErrors.ts';
import { ModelNotFoundError } from '../util/httpErrors.ts';
import type { FailureKind } from './modelPolicy.ts';

export function classifyFailureKind(error: unknown): FailureKind {
  if (error instanceof TerminalQuotaError) {
    return 'terminal';
  }
  if (error instanceof RetryableQuotaError) {
    return 'transient';
  }
  if (error instanceof ModelNotFoundError) {
    return 'not_found';
  }
  return 'unknown';
}
