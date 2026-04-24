/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview PRD Skill - Generates PRD from natural language.
 * 
 * Converts user requirements into structured PRD JSON:
 * - Natural language to user stories
 * - Priority assignment
 * - Acceptance criteria generation
 */

import { z } from 'zod';
import type { MessageBus } from '../confirmation-bus/message-bus.ts';
import { BaseDeclarativeTool, BaseToolInvocation, Kind, type ToolResult } from '../tools/tools.ts';
import { PRDManager, type UserStory, StoryStatus } from './prd-manager.ts';
import { debugLogger } from '../util/debugLogger.ts';

const PRD_SKILL_NAME = 'create_prd';

/** Parameters for PRD creation */
export interface CreatePRDParams {
    name: string;
    description: string;
    requirements: string;
}

/** PRD creation output */
interface PRDToolResult extends ToolResult {
    prdPath?: string;
    storyCount?: number;
}

/**
 * PRD Skill Tool Invocation
 */
class CreatePRDInvocation extends BaseToolInvocation<CreatePRDParams, PRDToolResult> {
    constructor(
        private readonly projectRoot: string,
        params: CreatePRDParams,
        messageBus: MessageBus,
        toolName?: string,
        displayName?: string,
    ) {
        super(params, messageBus, toolName, displayName);
    }

    getDescription(): string {
        return `Creating PRD: ${this.params.name}`;
    }

    async execute(_signal: AbortSignal): Promise<PRDToolResult> {
        const { name, description, requirements } = this.params;

        try {
            // Parse requirements into stories
            const stories = this.parseRequirementsToStories(requirements);

            // Create PRD using manager
            const prdManager = new PRDManager(this.projectRoot);
            const prd = await prdManager.create(name, description, stories);

            debugLogger.log(`[PRDSkill] Created PRD with ${prd.stories.length} stories`);

            return {
                llmContent: `Successfully created PRD "${name}" with ${prd.stories.length} user stories.

## Stories Created:
${prd.stories.map((s, i) => `${i + 1}. [P${s.priority}] ${s.title}`).join('\n')}

PRD saved to prd.tson. Run the autonomous loop to start execution.`,
                returnDisplay: `Created PRD: ${name} with ${prd.stories.length} stories`,
                prdPath: 'prd.tson',
                storyCount: prd.stories.length,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                llmContent: `Failed to create PRD: ${errorMessage}`,
                returnDisplay: `Error creating PRD: ${errorMessage}`,
            };
        }
    }

    /**
     * Parses natural language requirements into user stories.
     */
    private parseRequirementsToStories(requirements: string): Omit<UserStory, 'status' | 'passes'>[] {
        const lines = requirements.split('\n').filter(line => line.trim());
        const stories: Omit<UserStory, 'status' | 'passes'>[] = [];
        let priority = 1;

        for (const line of lines) {
            const trimmed = line.trim();

            // Skip empty lines and headers
            if (!trimmed || trimmed.startsWith('#')) continue;

            // Remove list markers
            const content = trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '');

            if (content) {
                stories.push({
                    id: `story-${priority}`,
                    title: this.generateTitle(content),
                    description: content,
                    priority,
                    acceptanceCriteria: this.generateAcceptanceCriteria(content),
                    estimatedComplexity: this.estimateComplexity(content),
                });
                priority++;
            }
        }

        // If no stories parsed, create one from the whole requirement
        if (stories.length === 0 && requirements.trim()) {
            stories.push({
                id: 'story-1',
                title: this.generateTitle(requirements),
                description: requirements,
                priority: 1,
                acceptanceCriteria: this.generateAcceptanceCriteria(requirements),
                estimatedComplexity: 'medium',
            });
        }

        return stories;
    }

    /**
     * Generates a short title from description.
     */
    private generateTitle(description: string): string {
        const words = description.split(' ').slice(0, 8);
        let title = words.join(' ');
        if (description.split(' ').length > 8) {
            title += '...';
        }
        return title;
    }

    /**
     * Generates basic acceptance criteria.
     */
    private generateAcceptanceCriteria(description: string): { description: string }[] {
        return [
            { description: `Implementation matches: ${description}` },
            { description: 'Code passes typecheck' },
            { description: 'Tests pass (if applicable)' },
        ];
    }

    /**
     * Estimates complexity based on keywords.
     */
    private estimateComplexity(description: string): 'small' | 'medium' | 'large' {
        const lower = description.toLowerCase();

        if (
            lower.includes('refactor') ||
            lower.includes('entire') ||
            lower.includes('system') ||
            lower.includes('architecture') ||
            lower.length > 200
        ) {
            return 'large';
        }

        if (
            lower.includes('add') ||
            lower.includes('create') ||
            lower.includes('implement') ||
            lower.length > 100
        ) {
            return 'medium';
        }

        return 'small';
    }
}

/**
 * PRD Skill Tool - creates PRDs from natural language.
 */
export class CreatePRDTool extends BaseDeclarativeTool<CreatePRDParams, PRDToolResult> {
    static readonly Name = PRD_SKILL_NAME;

    constructor(
        private readonly projectRoot: string,
        messageBus: MessageBus,
    ) {
        super(
            CreatePRDTool.Name,
            'CreatePRD',
            `Creates a Product Requirements Document (PRD) from natural language requirements.

The PRD is saved as prd.tson with structured user stories that can be executed by the autonomous loop agent.

Each story includes:
- Unique ID
- Title and description
- Priority (lower = higher priority)
- Acceptance criteria
- Estimated complexity

Use this when you need to break down a complex feature into manageable stories for autonomous execution.`,
            Kind.Think,
            {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Name of the feature/project',
                    },
                    description: {
                        type: 'string',
                        description: 'Brief description of the overall goal',
                    },
                    requirements: {
                        type: 'string',
                        description: 'Natural language requirements (one per line works best)',
                    },
                },
                required: ['name', 'description', 'requirements'],
            },
            messageBus,
            true,
            false,
        );
    }

    protected override validateToolParamValues(params: CreatePRDParams): string | null {
        if (!params.name?.trim()) {
            return 'Name is required';
        }
        if (!params.requirements?.trim()) {
            return 'Requirements are required';
        }
        return null;
    }

    protected createInvocation(
        params: CreatePRDParams,
        messageBus: MessageBus,
        toolName?: string,
        displayName?: string,
    ) {
        return new CreatePRDInvocation(
            this.projectRoot,
            params,
            messageBus,
            toolName ?? this.name,
            displayName ?? this.displayName,
        );
    }
}

