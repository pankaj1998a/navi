/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview PRD Manager - Ralph-inspired autonomous task execution.
 * 
 * Manages Product Requirements Document (PRD) execution:
 * - Load/parse prd.tson
 * - Priority-based task selection
 * - Track pass/fail status
 * - Auto-update on completion
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { debugLogger } from '../util/debugLogger.ts';

/** Status of a PRD story */
export enum StoryStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    PASSED = 'passed',
    FAILED = 'failed',
    SKIPPED = 'skipped',
}

/** Acceptance criteria for a story */
export interface AcceptanceCriteria {
    description: string;
    verified?: boolean;
}

/** A single user story in the PRD */
export interface UserStory {
    id: string;
    title: string;
    description: string;
    priority: number;
    status: StoryStatus;
    passes: boolean;
    acceptanceCriteria: AcceptanceCriteria[];
    dependencies?: string[];
    estimatedComplexity?: 'small' | 'medium' | 'large';
    iteration?: number;
    completedAt?: string;
    error?: string;
}

/** PRD document structure */
export interface PRDDocument {
    name: string;
    description: string;
    branchName: string;
    stories: UserStory[];
    createdAt: string;
    updatedAt: string;
    maxIterations: number;
    currentIteration: number;
}

/** Progress entry for tracking learnings */
export interface ProgressEntry {
    timestamp: string;
    iteration: number;
    storyId: string;
    action: 'started' | 'completed' | 'failed' | 'skipped';
    learning?: string;
    error?: string;
}

/** Default PRD file name */
const PRD_FILE = 'prd.tson';
const PROGRESS_FILE = 'progress.txt';

/**
 * PRD Manager - manages autonomous PRD-driven execution.
 */
export class PRDManager {
    private prd: PRDDocument | null = null;
    private prdPath: string;
    private progressPath: string;

    constructor(projectRoot: string) {
        this.prdPath = path.join(projectRoot, PRD_FILE);
        this.progressPath = path.join(projectRoot, PROGRESS_FILE);
    }

    /**
     * Loads the PRD from prd.tson.
     */
    async load(): Promise<PRDDocument | null> {
        try {
            const content = await fs.readFile(this.prdPath, 'utf-8');
            this.prd = JSON.parse(content) as PRDDocument;
            debugLogger.log(`[PRDManager] Loaded PRD: ${this.prd.name} with ${this.prd.stories.length} stories`);
            return this.prd;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                debugLogger.log('[PRDManager] No prd.tson found');
                return null;
            }
            throw error;
        }
    }

    /**
     * Saves the PRD to prd.tson.
     */
    async save(): Promise<void> {
        if (!this.prd) {
            throw new Error('[PRDManager] No PRD loaded');
        }
        this.prd.updatedAt = new Date().toISOString();
        await fs.writeFile(this.prdPath, JSON.stringify(this.prd, null, 2), 'utf-8');
        debugLogger.log('[PRDManager] Saved PRD');
    }

    /**
     * Creates a new PRD from scratch.
     */
    async create(name: string, description: string, stories: Omit<UserStory, 'status' | 'passes'>[]): Promise<PRDDocument> {
        const now = new Date().toISOString();
        const branchName = `feature/${name.toLowerCase().replace(/\s+/g, '-')}`;

        this.prd = {
            name,
            description,
            branchName,
            stories: stories.map(story => ({
                ...story,
                status: StoryStatus.PENDING,
                passes: false,
            })),
            createdAt: now,
            updatedAt: now,
            maxIterations: 10,
            currentIteration: 0,
        };

        await this.save();
        await this.createGitBranch();
        debugLogger.log(`[PRDManager] Created PRD: ${name}`);
        return this.prd;
    }

    /**
     * Creates a git branch for the PRD.
     */
    async createGitBranch(): Promise<boolean> {
        if (!this.prd) return false;

        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        try {
            // Check if branch already exists
            const { stdout } = await execAsync(`git branch --list "${this.prd.branchName}"`);
            if (stdout.trim()) {
                debugLogger.log(`[PRDManager] Branch ${this.prd.branchName} already exists`);
                return true;
            }

            // Create and checkout new branch
            await execAsync(`git checkout -b "${this.prd.branchName}"`);
            debugLogger.log(`[PRDManager] Created branch: ${this.prd.branchName}`);
            return true;
        } catch (error) {
            debugLogger.log(`[PRDManager] Failed to create branch: ${error}`);
            return false;
        }
    }

    /**
     * Updates AGENTS.md with learnings from completed stories.
     */
    async updateAgentsMd(learning: string): Promise<void> {
        const agentsMdPath = path.join(path.dirname(this.prdPath), 'AGENTS.md');

        try {
            let content = '';
            try {
                content = await fs.readFile(agentsMdPath, 'utf-8');
            } catch {
                // File doesn't exist, create with header
                content = '# AGENTS.md\n\nContext and learnings for AI agents working on this codebase.\n\n';
            }

            // Add learnings section if not present
            if (!content.includes('## Learnings')) {
                content += '\n## Learnings\n\n';
            }

            // Append new learning with timestamp
            const timestamp = new Date().toISOString().split('T')[0];
            const newEntry = `- [${timestamp}] ${learning}\n`;

            // Insert before the end of learnings section or at end
            const learningsIndex = content.indexOf('## Learnings');
            const nextSectionIndex = content.indexOf('\n## ', learningsIndex + 1);

            if (nextSectionIndex > -1) {
                content = content.slice(0, nextSectionIndex) + newEntry + content.slice(nextSectionIndex);
            } else {
                content += newEntry;
            }

            await fs.writeFile(agentsMdPath, content, 'utf-8');
            debugLogger.log(`[PRDManager] Updated AGENTS.md with learning`);
        } catch (error) {
            debugLogger.log(`[PRDManager] Failed to update AGENTS.md: ${error}`);
        }
    }

    /**
     * Gets the next story to work on based on priority.
     * Returns the highest priority story that hasn't passed yet.
     */
    getNextStory(): UserStory | null {
        if (!this.prd) return null;

        // Filter stories that haven't passed and have all dependencies met
        const available = this.prd.stories.filter(story => {
            if (story.passes) return false;
            if (story.status === StoryStatus.SKIPPED) return false;

            // Check dependencies
            if (story.dependencies && story.dependencies.length > 0) {
                const allDepsPassed = story.dependencies.every(depId => {
                    const dep = this.prd!.stories.find(s => s.id === depId);
                    return dep?.passes === true;
                });
                if (!allDepsPassed) return false;
            }

            return true;
        });

        if (available.length === 0) return null;

        // Sort by priority (lower number = higher priority)
        available.sort((a, b) => a.priority - b.priority);
        return available[0];
    }

    /**
     * Marks a story as started.
     */
    async startStory(storyId: string): Promise<void> {
        const story = this.findStory(storyId);
        if (!story) throw new Error(`Story ${storyId} not found`);

        story.status = StoryStatus.IN_PROGRESS;
        story.iteration = this.prd!.currentIteration;
        await this.save();
        await this.appendProgress({
            timestamp: new Date().toISOString(),
            iteration: this.prd!.currentIteration,
            storyId,
            action: 'started',
        });
    }

    /**
     * Marks a story as completed (passed).
     */
    async completeStory(storyId: string, learning?: string): Promise<void> {
        const story = this.findStory(storyId);
        if (!story) throw new Error(`Story ${storyId} not found`);

        story.status = StoryStatus.PASSED;
        story.passes = true;
        story.completedAt = new Date().toISOString();
        await this.save();
        await this.appendProgress({
            timestamp: new Date().toISOString(),
            iteration: this.prd!.currentIteration,
            storyId,
            action: 'completed',
            learning,
        });
    }

    /**
     * Marks a story as failed.
     */
    async failStory(storyId: string, error: string): Promise<void> {
        const story = this.findStory(storyId);
        if (!story) throw new Error(`Story ${storyId} not found`);

        story.status = StoryStatus.FAILED;
        story.error = error;
        await this.save();
        await this.appendProgress({
            timestamp: new Date().toISOString(),
            iteration: this.prd!.currentIteration,
            storyId,
            action: 'failed',
            error,
        });
    }

    /**
     * Checks if all stories have passed.
     */
    isComplete(): boolean {
        if (!this.prd) return false;
        return this.prd.stories.every(s => s.passes || s.status === StoryStatus.SKIPPED);
    }

    /**
     * Increments the iteration counter.
     */
    async incrementIteration(): Promise<number> {
        if (!this.prd) throw new Error('[PRDManager] No PRD loaded');
        this.prd.currentIteration += 1;
        await this.save();
        return this.prd.currentIteration;
    }

    /**
     * Gets current iteration number.
     */
    getCurrentIteration(): number {
        return this.prd?.currentIteration ?? 0;
    }

    /**
     * Gets max iterations allowed.
     */
    getMaxIterations(): number {
        return this.prd?.maxIterations ?? 10;
    }

    /**
     * Gets progress summary.
     */
    getProgressSummary(): { total: number; passed: number; failed: number; pending: number } {
        if (!this.prd) return { total: 0, passed: 0, failed: 0, pending: 0 };

        return {
            total: this.prd.stories.length,
            passed: this.prd.stories.filter(s => s.passes).length,
            failed: this.prd.stories.filter(s => s.status === StoryStatus.FAILED).length,
            pending: this.prd.stories.filter(s => !s.passes && s.status !== StoryStatus.FAILED && s.status !== StoryStatus.SKIPPED).length,
        };
    }

    /**
     * Appends an entry to progress.txt.
     */
    private async appendProgress(entry: ProgressEntry): Promise<void> {
        const line = this.formatProgressEntry(entry);
        try {
            await fs.appendFile(this.progressPath, line + '\n', 'utf-8');
        } catch (error) {
            // File might not exist, create it
            await fs.writeFile(this.progressPath, line + '\n', 'utf-8');
        }
    }

    /**
     * Formats a progress entry for logging.
     */
    private formatProgressEntry(entry: ProgressEntry): string {
        const parts = [
            `[${entry.timestamp}]`,
            `Iteration ${entry.iteration}`,
            `Story: ${entry.storyId}`,
            `Action: ${entry.action}`,
        ];
        if (entry.learning) parts.push(`Learning: ${entry.learning}`);
        if (entry.error) parts.push(`Error: ${entry.error}`);
        return parts.join(' | ');
    }

    /**
     * Finds a story by ID.
     */
    private findStory(storyId: string): UserStory | undefined {
        return this.prd?.stories.find(s => s.id === storyId);
    }

    /**
     * Gets the current PRD.
     */
    getPRD(): PRDDocument | null {
        return this.prd;
    }

    /**
     * Generates example PRD JSON.
     */
    static generateExamplePRD(): PRDDocument {
        return {
            name: 'Example Feature',
            description: 'An example PRD for demonstration',
            branchName: 'feature/example-feature',
            stories: [
                {
                    id: 'story-1',
                    title: 'Add user authentication',
                    description: 'Implement login and logout functionality',
                    priority: 1,
                    status: StoryStatus.PENDING,
                    passes: false,
                    acceptanceCriteria: [
                        { description: 'User can log in with email/password' },
                        { description: 'User can log out' },
                        { description: 'Session persists across page reloads' },
                    ],
                    estimatedComplexity: 'medium',
                },
                {
                    id: 'story-2',
                    title: 'Add user profile page',
                    description: 'Create a profile page showing user info',
                    priority: 2,
                    status: StoryStatus.PENDING,
                    passes: false,
                    acceptanceCriteria: [
                        { description: 'Profile displays user name and email' },
                        { description: 'User can edit their name' },
                    ],
                    dependencies: ['story-1'],
                    estimatedComplexity: 'small',
                },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            maxIterations: 10,
            currentIteration: 0,
        };
    }
}

