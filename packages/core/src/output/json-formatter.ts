/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import stripAnsi from 'strip-ansi';
import type { SessionMetrics } from '../telemetry/uiTelemetry.ts';
import type { JsonError, JsonOutput } from './types.ts';

export class JsonFormatter {
  format(
    sessionId?: string,
    response?: string,
    stats?: SessionMetrics,
    error?: JsonError,
  ): string {
    const output: JsonOutput = {};

    if (sessionId) {
      output.session_id = sessionId;
    }

    if (response !== undefined) {
      output.response = stripAnsi(response);
    }

    if (stats) {
      output.stats = stats;
    }

    if (error) {
      output.error = error;
    }

    return JSON.stringify(output, null, 2);
  }

  formatError(
    error: Error,
    code?: string | number,
    sessionId?: string,
  ): string {
    const jsonError: JsonError = {
      type: error.constructor.name,
      message: stripAnsi(error.message),
      ...(code && { code }),
    };

    return this.format(sessionId, undefined, undefined, jsonError);
  }
}
