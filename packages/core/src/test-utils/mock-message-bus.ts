/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageBus } from '../confirmation-bus/message-bus.ts';
import type { PolicyEngine } from '../policy/policy-engine.ts';

/**
 * Creates a mock MessageBus for testing purposes.
 */
export function createMockMessageBus(): MessageBus {
  const mockPolicyEngine = {
    check: async () => ({ decision: 'allow' }),
    checkHook: async () => 'allow',
  } as unknown as PolicyEngine;

  return new MessageBus(mockPolicyEngine);
}
