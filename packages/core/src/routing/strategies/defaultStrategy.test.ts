/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { DefaultStrategy } from './defaultStrategy.ts';
import type { RoutingContext } from '../routingStrategy.ts';
import type { BaseLlmClient } from '../../core/baseLlmClient.ts';
import { DEFAULT_GEMINI_MODEL } from '../../config/models.ts';
import type { Config } from '../../config/config.ts';

describe('DefaultStrategy', () => {
  it('should always route to the default Gemini model', async () => {
    const strategy = new DefaultStrategy();
    const mockContext = {} as RoutingContext;
    const mockConfig = {} as Config;
    const mockClient = {} as BaseLlmClient;

    const decision = await strategy.route(mockContext, mockConfig, mockClient);

    expect(decision).toEqual({
      model: DEFAULT_GEMINI_MODEL,
      metadata: {
        source: 'default',
        latencyMs: 0,
        reasoning: `Routing to default model: ${DEFAULT_GEMINI_MODEL}`,
      },
    });
  });
});
