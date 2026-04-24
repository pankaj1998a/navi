/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Autonomous Loop Agent - Ralph-inspired continuous execution.
 * 
 * Runs agents in a loop until all PRD items are complete:
 * - Fresh context per iteration
 * - Progress tracking via progress.txt
 * - Stop condition when all stories pass
 * - Max iterations limit
 */

import { z } from 'zod';
import type { Config } from '../config/config.ts';
import type { AgentRegistry } from './agent-registry.ts';
import type { LocalAgentDefinition, OutputObject } from './types.ts';
import { PRDManager, StoryStatus, type UserStory } from '../skills/prd-manager.ts';
import { AgentMemory } from './agent-memory.ts';
import { debugLogger } from '../util/debugLogger.ts';

/** Autonomous loop output schema */
const AutonomousLoopOutputSchema = z.object({
    complete: z.boolean().describe('Whether all PRD items are complete'),
    iterations: z.number().describe('Number of iterations executed'),
    storiesCompleted: z.number().describe('Number of stories completed'),
    storiesFailed: z.number().describe('Number of stories that failed'),
    summary: z.string().describe('Summary of the execution'),
});

/** Loop state for tracking execution */
export interface LoopState {
    iteration: number;
    startTime: number;
    storiesProcessed: string[];
    errors: Array<{ storyId: string; error: string }>;
}

/** Iteration result */
export interface IterationResult {
    storyId: string;
    success: boolean;
    output?: string;
    error?: string;
    durationMs: number;
}

/**
 * Autonomous Loop Agent Definition
 * Runs in a loop until PRD is complete or max iterations reached.
 */
export const AutonomousLoopAgent = (
    config: Config,
    registry: AgentRegistry,
    projectRoot: string,
): LocalAgentDefinition<typeof AutonomousLoopOutputSchema> => ({
    kind: 'local',
    name: 'autonomous_loop',
    displayName: 'Autonomous Loop',
    description:
        'Ralph-inspired autonomous agent that executes PRD stories in a loop until complete. Fresh context per iteration with progress tracking.',
    experimental: true,
    inputConfig: {
        inputs: {
            max_iterations: {
                description: 'Maximum number of iterations to run (default: 10).',
                type: 'integer',
                required: false,
            },
            stop_on_failure: {
                description: 'Stop the loop if a story fails (default: false).',
                type: 'boolean',
                required: false,
            },
        },
    },
    outputConfig: {
        outputName: 'result',
        description: 'Summary of autonomous execution results.',
        schema: AutonomousLoopOutputSchema,
    },
    modelConfig: {
        model: 'auto',
    },
    get toolConfig() {
        return {
            tools: [
                'delegate_to_agent',
                'read_file',
                'write_file',
                'shell',
                'list_directory',
            ],
        };
    },
    get promptConfig() {
        return {
            systemPrompt: `You are the Autonomous Loop Agent, executing PRD stories until complete.

## Your Mission
Execute each story from prd.tson in priority order until all pass.

## Loop Protocol
1. Load prd.tson
2. Pick highest priority story where passes=false
3. Execute the story using appropriate tools
4. Run quality checks (typecheck, tests)
5. Mark story as passed if checks succeed
6. Update progress.txt with learnings
7. Repeat until all stories pass or max iterations reached

## Quality Checks
After completing each story:
- Run typecheck if applicable
- Run tests if applicable
- Verify acceptance criteria

## Progress Tracking
After each iteration, append to progress.txt:
- What was attempted
- What succeeded/failed
- Learnings for future iterations

## Stop Conditions
- All stories have passes: true
- Max iterations reached
- Critical failure (if stop_on_failure=true)

Output <promise>COMPLETE</promise> when done.`,
            query: 'Execute the PRD stories in autonomous loop mode.',
        };
    },
    runConfig: {
        maxTimeMinutes: 60,
        maxTurns: 100,
    },
    processOutput: (output) => {
        return `## Autonomous Loop Results

**Complete**: ${output.complete ? '✅ All stories passed!' : '⏳ In progress'}

### Stats
- Iterations: ${output.iterations}
- Stories Completed: ${output.storiesCompleted}
- Stories Failed: ${output.storiesFailed}

### Summary
${output.summary}
`;
    },
});

/**
 * Autonomous Loop Controller
 * Manages the execution loop for PRD-driven development.
 */
export class AutonomousLoopController {
    private prdManager: PRDManager;
    private memory: AgentMemory;
    private state: LoopState;
    private config: AutonomousLoopConfig;

    constructor(projectRoot: string, config?: Partial<AutonomousLoopConfig>) {
        this.prdManager = new PRDManager(projectRoot);
        this.memory = AgentMemory.getInstance();
        this.config = {
            maxIterations: config?.maxIterations ?? 10,
            stopOnFailure: config?.stopOnFailure ?? false,
            iterationDelayMs: config?.iterationDelayMs ?? 1000,
            qualityChecks: config?.qualityChecks ?? ['typecheck'],
        };
        this.state = {
            iteration: 0,
            startTime: Date.now(),
            storiesProcessed: [],
            errors: [],
        };
    }

    /**
     * Starts the autonomous loop.
     */
    async run(executor: StoryExecutor): Promise<LoopResult> {
        debugLogger.log('[AutonomousLoop] Starting autonomous loop');

        // Load PRD
        const prd = await this.prdManager.load();
        if (!prd) {
            return {
                complete: false,
                iterations: 0,
                storiesCompleted: 0,
                storiesFailed: 0,
                summary: 'No prd.tson found. Create a PRD first.',
            };
        }

        // Main loop
        while (!this.shouldStop()) {
            const result = await this.executeIteration(executor);

            if (!result) {
                // No more stories to process
                break;
            }

            // Brief delay between iterations
            await this.delay(this.config.iterationDelayMs);
        }

        return this.generateResult();
    }

    /**
     * Executes a single iteration of the loop.
     */
    private async executeIteration(executor: StoryExecutor): Promise<IterationResult | null> {
        await this.prdManager.incrementIteration();
        this.state.iteration = this.prdManager.getCurrentIteration();

        debugLogger.log(`[AutonomousLoop] Starting iteration ${this.state.iteration}`);

        // Get next story
        const story = this.prdManager.getNextStory();
        if (!story) {
            debugLogger.log('[AutonomousLoop] No more stories to process');
            return null;
        }

        debugLogger.log(`[AutonomousLoop] Processing story: ${story.id} - ${story.title}`);

        // Mark as in progress
        await this.prdManager.startStory(story.id);
        this.state.storiesProcessed.push(story.id);

        const startTime = Date.now();

        try {
            // Execute the story
            const output = await executor(story, this.state.iteration);

            // Run quality checks
            const checksPass = await this.runQualityChecks();

            if (checksPass) {
                await this.prdManager.completeStory(
                    story.id,
                    `Completed in iteration ${this.state.iteration}`
                );

                return {
                    storyId: story.id,
                    success: true,
                    output,
                    durationMs: Date.now() - startTime,
                };
            } else {
                const error = 'Quality checks failed';
                await this.prdManager.failStory(story.id, error);
                this.state.errors.push({ storyId: story.id, error });

                return {
                    storyId: story.id,
                    success: false,
                    error,
                    durationMs: Date.now() - startTime,
                };
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            await this.prdManager.failStory(story.id, errorMsg);
            this.state.errors.push({ storyId: story.id, error: errorMsg });

            return {
                storyId: story.id,
                success: false,
                error: errorMsg,
                durationMs: Date.now() - startTime,
            };
        }
    }

    /**
     * Determines if the loop should stop.
     */
    private shouldStop(): boolean {
        // Check if complete
        if (this.prdManager.isComplete()) {
            debugLogger.log('[AutonomousLoop] All stories complete!');
            return true;
        }

        // Check max iterations
        if (this.state.iteration >= this.config.maxIterations) {
            debugLogger.log('[AutonomousLoop] Max iterations reached');
            return true;
        }

        // Check stop on failure
        if (this.config.stopOnFailure && this.state.errors.length > 0) {
            debugLogger.log('[AutonomousLoop] Stopped due to failure');
            return true;
        }

        return false;
    }

    /**
     * Runs quality checks (typecheck, tests, etc.).
     */
    private async runQualityChecks(): Promise<boolean> {
        debugLogger.log('[AutonomousLoop] Running quality checks...');

        const results: { check: string; passed: boolean; error?: string }[] = [];

        for (const check of this.config.qualityChecks) {
            try {
                const passed = await this.runCheck(check);
                results.push({ check, passed });

                if (!passed) {
                    debugLogger.log(`[AutonomousLoop] Quality check FAILED: ${check}`);
                    return false;
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                results.push({ check, passed: false, error: errorMsg });
                debugLogger.log(`[AutonomousLoop] Quality check ERROR: ${check} - ${errorMsg}`);
                return false;
            }
        }

        debugLogger.log('[AutonomousLoop] All quality checks passed!');
        return true;
    }

    /**
     * Runs a single quality check.
     */
    private async runCheck(check: string): Promise<boolean> {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const commands: Record<string, string> = {
            typecheck: 'bun run typecheck',
            test: 'bun test',
            lint: 'bun run lint',
            build: 'bun run build',
        };

        const cmd = commands[check];
        if (!cmd) {
            debugLogger.log(`[AutonomousLoop] Unknown check: ${check}, skipping`);
            return true;
        }

        try {
            debugLogger.log(`[AutonomousLoop] Running: ${cmd}`);
            await execAsync(cmd, { timeout: 60000 });
            return true;
        } catch (error) {
            // Non-zero exit code means check failed
            return false;
        }
    }

    /**
     * Generates the final result.
     */
    private generateResult(): LoopResult {
        const progress = this.prdManager.getProgressSummary();
        const complete = this.prdManager.isComplete();
        const duration = Date.now() - this.state.startTime;

        return {
            complete,
            iterations: this.state.iteration,
            storiesCompleted: progress.passed,
            storiesFailed: progress.failed,
            summary: this.formatSummary(complete, progress, duration),
        };
    }

    /**
     * Formats the result summary.
     */
    private formatSummary(
        complete: boolean,
        progress: { total: number; passed: number; failed: number; pending: number },
        duration: number
    ): string {
        const minutes = Math.round(duration / 60000);
        const status = complete ? 'COMPLETE' : `INCOMPLETE (${progress.pending} pending)`;

        return `
Autonomous loop ${status}
- Total stories: ${progress.total}
- Passed: ${progress.passed}
- Failed: ${progress.failed}
- Pending: ${progress.pending}
- Duration: ${minutes} minutes
- Iterations: ${this.state.iteration}
${this.state.errors.length > 0 ? `\nErrors:\n${this.state.errors.map(e => `- ${e.storyId}: ${e.error}`).join('\n')}` : ''}
`.trim();
    }

    /**
     * Utility delay function.
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/** Configuration for the autonomous loop */
export interface AutonomousLoopConfig {
    maxIterations: number;
    stopOnFailure: boolean;
    iterationDelayMs: number;
    qualityChecks: string[];
}

/** Result of the autonomous loop */
export interface LoopResult {
    complete: boolean;
    iterations: number;
    storiesCompleted: number;
    storiesFailed: number;
    summary: string;
}

/** Function type for story execution */
export type StoryExecutor = (story: UserStory, iteration: number) => Promise<string>;

