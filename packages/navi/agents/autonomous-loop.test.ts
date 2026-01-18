/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    AutonomousLoopController,
    type LoopResult,
    type StoryExecutor,
} from './autonomous-loop.js';
import { PRDManager, StoryStatus, type UserStory } from './prd-manager.js';

// Mock PRDManager
vi.mock('./prd-manager.js', async () => {
    const actual = await vi.importActual('./prd-manager.js');
    return {
        ...actual,
        PRDManager: vi.fn().mockImplementation(() => ({
            load: vi.fn(),
            save: vi.fn(),
            getNextStory: vi.fn(),
            startStory: vi.fn(),
            completeStory: vi.fn(),
            failStory: vi.fn(),
            isComplete: vi.fn(),
            incrementIteration: vi.fn().mockResolvedValue(1),
            getCurrentIteration: vi.fn().mockReturnValue(0),
            getMaxIterations: vi.fn().mockReturnValue(10),
            getProgressSummary: vi.fn().mockReturnValue({
                total: 2,
                passed: 0,
                failed: 0,
                pending: 2,
            }),
            getPRD: vi.fn(),
        })),
    };
});

describe('AutonomousLoopController', () => {
    let controller: AutonomousLoopController;
    let mockExecutor: StoryExecutor;

    beforeEach(() => {
        vi.clearAllMocks();
        controller = new AutonomousLoopController('/test/project');
        mockExecutor = vi.fn().mockResolvedValue('Executed successfully');
    });

    describe('run', () => {
        it('should return early if no PRD exists', async () => {
            const prdManager = (controller as any).prdManager;
            prdManager.load.mockResolvedValue(null);

            const result = await controller.run(mockExecutor);

            expect(result.complete).toBe(false);
            expect(result.summary).toContain('No prd.json found');
        });

        it('should stop when all stories are complete', async () => {
            const prdManager = (controller as any).prdManager;
            prdManager.load.mockResolvedValue({ name: 'Test', stories: [] });
            prdManager.isComplete.mockReturnValue(true);
            prdManager.getProgressSummary.mockReturnValue({
                total: 2,
                passed: 2,
                failed: 0,
                pending: 0,
            });

            const result = await controller.run(mockExecutor);

            expect(result.complete).toBe(true);
        });

        it('should stop when max iterations reached', async () => {
            const prdManager = (controller as any).prdManager;
            prdManager.load.mockResolvedValue({ name: 'Test', stories: [] });
            prdManager.isComplete.mockReturnValue(false);
            prdManager.getNextStory.mockReturnValue(null);

            const result = await controller.run(mockExecutor);

            expect(result.complete).toBe(false);
        });
    });

    describe('configuration', () => {
        it('should respect maxIterations config', () => {
            const customController = new AutonomousLoopController('/test', {
                maxIterations: 5,
            });

            expect((customController as any).config.maxIterations).toBe(5);
        });

        it('should respect stopOnFailure config', () => {
            const customController = new AutonomousLoopController('/test', {
                stopOnFailure: true,
            });

            expect((customController as any).config.stopOnFailure).toBe(true);
        });
    });

    describe('generateResult', () => {
        it('should include correct summary', async () => {
            const prdManager = (controller as any).prdManager;
            prdManager.load.mockResolvedValue({ name: 'Test', stories: [] });
            prdManager.isComplete.mockReturnValue(true);
            prdManager.getProgressSummary.mockReturnValue({
                total: 3,
                passed: 2,
                failed: 1,
                pending: 0,
            });

            const result = await controller.run(mockExecutor);

            expect(result.storiesCompleted).toBe(2);
            expect(result.storiesFailed).toBe(1);
        });
    });
});
