/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  PRDManager,
  StoryStatus,
  type PRDDocument,
  type UserStory,
} from './prd-manager.js';

describe('PRDManager', () => {
  let tempDir: string;
  let prdManager: PRDManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prd-test-'));
    prdManager = new PRDManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a new PRD with stories', async () => {
      const stories = [
        {
          id: 'story-1',
          title: 'Test Story',
          description: 'A test story',
          priority: 1,
          acceptanceCriteria: [{ description: 'Test passes' }],
        },
      ];

      const prd = await prdManager.create('Test PRD', 'Test description', stories);

      expect(prd.name).toBe('Test PRD');
      expect(prd.description).toBe('Test description');
      expect(prd.stories).toHaveLength(1);
      expect(prd.stories[0].status).toBe(StoryStatus.PENDING);
      expect(prd.stories[0].passes).toBe(false);
    });

    it('should save PRD to prd.json', async () => {
      await prdManager.create('Test', 'Desc', []);
      
      const content = await fs.readFile(path.join(tempDir, 'prd.json'), 'utf-8');
      const prd = JSON.parse(content) as PRDDocument;
      
      expect(prd.name).toBe('Test');
    });
  });

  describe('load', () => {
    it('should load existing PRD', async () => {
      const prdData: PRDDocument = {
        name: 'Existing PRD',
        description: 'Test',
        branchName: 'feature/test',
        stories: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        maxIterations: 10,
        currentIteration: 0,
      };
      
      await fs.writeFile(
        path.join(tempDir, 'prd.json'),
        JSON.stringify(prdData),
        'utf-8'
      );

      const loaded = await prdManager.load();
      
      expect(loaded?.name).toBe('Existing PRD');
    });

    it('should return null if no PRD exists', async () => {
      const result = await prdManager.load();
      expect(result).toBeNull();
    });
  });

  describe('getNextStory', () => {
    it('should return highest priority pending story', async () => {
      await prdManager.create('Test', 'Test', [
        { id: 's1', title: 'Low', description: 'Low', priority: 2, acceptanceCriteria: [] },
        { id: 's2', title: 'High', description: 'High', priority: 1, acceptanceCriteria: [] },
      ]);

      const next = prdManager.getNextStory();
      
      expect(next?.id).toBe('s2');
      expect(next?.priority).toBe(1);
    });

    it('should skip passed stories', async () => {
      await prdManager.create('Test', 'Test', [
        { id: 's1', title: 'Done', description: 'Done', priority: 1, acceptanceCriteria: [] },
        { id: 's2', title: 'Pending', description: 'Pending', priority: 2, acceptanceCriteria: [] },
      ]);
      
      await prdManager.completeStory('s1');
      const next = prdManager.getNextStory();
      
      expect(next?.id).toBe('s2');
    });

    it('should respect dependencies', async () => {
      await prdManager.create('Test', 'Test', [
        { id: 's1', title: 'First', description: 'First', priority: 2, acceptanceCriteria: [] },
        { id: 's2', title: 'Second', description: 'Second', priority: 1, acceptanceCriteria: [], dependencies: ['s1'] },
      ]);

      // s2 has higher priority but depends on s1
      const next = prdManager.getNextStory();
      
      expect(next?.id).toBe('s1');
    });
  });

  describe('story lifecycle', () => {
    beforeEach(async () => {
      await prdManager.create('Test', 'Test', [
        { id: 's1', title: 'Story', description: 'Story', priority: 1, acceptanceCriteria: [] },
      ]);
    });

    it('should mark story as in progress', async () => {
      await prdManager.startStory('s1');
      const prd = prdManager.getPRD();
      
      expect(prd?.stories[0].status).toBe(StoryStatus.IN_PROGRESS);
    });

    it('should mark story as passed', async () => {
      await prdManager.completeStory('s1', 'Completed successfully');
      const prd = prdManager.getPRD();
      
      expect(prd?.stories[0].status).toBe(StoryStatus.PASSED);
      expect(prd?.stories[0].passes).toBe(true);
    });

    it('should mark story as failed', async () => {
      await prdManager.failStory('s1', 'Test failed');
      const prd = prdManager.getPRD();
      
      expect(prd?.stories[0].status).toBe(StoryStatus.FAILED);
      expect(prd?.stories[0].error).toBe('Test failed');
    });
  });

  describe('isComplete', () => {
    it('should return true when all stories pass', async () => {
      await prdManager.create('Test', 'Test', [
        { id: 's1', title: 'S1', description: 'S1', priority: 1, acceptanceCriteria: [] },
        { id: 's2', title: 'S2', description: 'S2', priority: 2, acceptanceCriteria: [] },
      ]);
      
      await prdManager.completeStory('s1');
      await prdManager.completeStory('s2');
      
      expect(prdManager.isComplete()).toBe(true);
    });

    it('should return false when stories remain', async () => {
      await prdManager.create('Test', 'Test', [
        { id: 's1', title: 'S1', description: 'S1', priority: 1, acceptanceCriteria: [] },
      ]);
      
      expect(prdManager.isComplete()).toBe(false);
    });
  });

  describe('progress tracking', () => {
    it('should append to progress.txt', async () => {
      await prdManager.create('Test', 'Test', [
        { id: 's1', title: 'S1', description: 'S1', priority: 1, acceptanceCriteria: [] },
      ]);
      
      await prdManager.startStory('s1');
      await prdManager.completeStory('s1', 'Done!');
      
      const progress = await fs.readFile(path.join(tempDir, 'progress.txt'), 'utf-8');
      
      expect(progress).toContain('s1');
      expect(progress).toContain('started');
      expect(progress).toContain('completed');
    });
  });

  describe('getProgressSummary', () => {
    it('should return correct counts', async () => {
      await prdManager.create('Test', 'Test', [
        { id: 's1', title: 'S1', description: 'S1', priority: 1, acceptanceCriteria: [] },
        { id: 's2', title: 'S2', description: 'S2', priority: 2, acceptanceCriteria: [] },
        { id: 's3', title: 'S3', description: 'S3', priority: 3, acceptanceCriteria: [] },
      ]);
      
      await prdManager.completeStory('s1');
      await prdManager.failStory('s2', 'Failed');
      
      const summary = prdManager.getProgressSummary();
      
      expect(summary.total).toBe(3);
      expect(summary.passed).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.pending).toBe(1);
    });
  });
});
