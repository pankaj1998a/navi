/**
 * Dynamic Tool Selection
 *
 * Intelligently selects and prioritizes tools based on task requirements,
 * context, and historical performance.
 */

import { Log } from "../util/log";

const log = Log.create({ service: "tool-selection" });

/**
 * Tool metadata for intelligent selection
 */
export interface ToolMetadata {
    /** Tool ID */
    id: string;
    /** Tool category */
    category: string;
    /** Estimated execution time (ms) */
    avgExecutionTime: number;
    /** Success rate (0-1) */
    successRate: number;
    /** Cost factor (0-1, higher = more expensive) */
    costFactor: number;
    /** Common use cases */
    useCases: string[];
    /** Dependencies (other tools needed) */
    dependencies: string[];
    /** Permissions required */
    permissions: string[];
}

/**
 * Task analysis for tool selection
 */
export interface TaskAnalysis {
    /** Task type */
    type: string;
    /** Required capabilities */
    capabilities: string[];
    /** Estimated complexity */
    complexity: number;
    /** Time sensitivity */
    timeSensitive: boolean;
    /** Cost sensitivity */
    costSensitive: boolean;
}

/**
 * Analyze task to determine required tools
 */
export function analyzeTaskForTools(taskDescription: string): TaskAnalysis {
    const analysis: TaskAnalysis = {
        type: "general",
        capabilities: [],
        complexity: 0,
        timeSensitive: false,
        costSensitive: false,
    };

    const taskLower = taskDescription.toLowerCase();

    // Determine task type
    if (/read|view|look|show|cat|grep|find/i.test(taskDescription)) {
        analysis.type = "read";
        analysis.capabilities.push("file-read", "search");
    } else if (/write|edit|create|implement|add|modify/i.test(taskDescription)) {
        analysis.type = "write";
        analysis.capabilities.push("file-write", "edit");
    } else if (/execute|run|command|bash|shell/i.test(taskDescription)) {
        analysis.type = "execute";
        analysis.capabilities.push("shell", "command");
    } else if (/search|find|grep|look for/i.test(taskDescription)) {
        analysis.type = "search";
        analysis.capabilities.push("search", "grep");
    } else if (/test|verify|check|validate/i.test(taskDescription)) {
        analysis.type = "test";
        analysis.capabilities.push("test", "execute");
    }

    // Determine complexity
    const wordCount = taskDescription.split(/\s+/).length;
    if (wordCount > 50) {
        analysis.complexity = 3;
        analysis.capabilities.push("analysis", "planning");
    } else if (wordCount > 20) {
        analysis.complexity = 2;
    } else {
        analysis.complexity = 1;
    }

    // Check for time sensitivity
    if (/urgent|immediate|quick|fast|now/i.test(taskDescription)) {
        analysis.timeSensitive = true;
    }

    // Check for cost sensitivity
    if (/cheap|budget|cost|efficient/i.test(taskDescription)) {
        analysis.costSensitive = true;
    }

    log.info("Task analysis for tool selection", {
        type: analysis.type,
        capabilities: analysis.capabilities,
        complexity: analysis.complexity,
    });

    return analysis;
}

/**
 * Get tool metadata
 */
export function getToolMetadata(toolId: string): ToolMetadata | null {
    // Predefined tool metadata
    const toolMetadata: Record<string, ToolMetadata> = {
        "read": {
            id: "read",
            category: "file",
            avgExecutionTime: 100,
            successRate: 0.95,
            costFactor: 0.1,
            useCases: ["view file contents", "read documentation", "check code"],
            dependencies: [],
            permissions: ["read"],
        },
        "write": {
            id: "write",
            category: "file",
            avgExecutionTime: 200,
            successRate: 0.9,
            costFactor: 0.2,
            useCases: ["create files", "write code", "save output"],
            dependencies: ["read"],
            permissions: ["write"],
        },
        "edit": {
            id: "edit",
            category: "file",
            avgExecutionTime: 300,
            successRate: 0.85,
            costFactor: 0.3,
            useCases: ["modify files", "refactor code", "fix bugs"],
            dependencies: ["read"],
            permissions: ["write"],
        },
        "bash": {
            id: "bash",
            category: "shell",
            avgExecutionTime: 500,
            successRate: 0.8,
            costFactor: 0.1,
            useCases: ["run commands", "execute scripts", "system operations"],
            dependencies: [],
            permissions: ["shell"],
        },
        "grep": {
            id: "grep",
            category: "search",
            avgExecutionTime: 200,
            successRate: 0.9,
            costFactor: 0.1,
            useCases: ["search text", "find patterns", "code search"],
            dependencies: [],
            permissions: ["read"],
        },
        "glob": {
            id: "glob",
            category: "search",
            avgExecutionTime: 100,
            successRate: 0.95,
            costFactor: 0.1,
            useCases: ["find files", "list files", "file matching"],
            dependencies: [],
            permissions: ["read"],
        },
        "codesearch": {
            id: "codesearch",
            category: "search",
            avgExecutionTime: 1000,
            successRate: 0.7,
            costFactor: 0.8,
            useCases: ["semantic search", "code understanding", "finding similar code"],
            dependencies: [],
            permissions: ["read"],
        },
        "websearch": {
            id: "websearch",
            category: "search",
            avgExecutionTime: 2000,
            successRate: 0.6,
            costFactor: 0.9,
            useCases: ["web research", "documentation lookup", "current information"],
            dependencies: [],
            permissions: ["web"],
        },
        "browser": {
            id: "browser",
            category: "web",
            avgExecutionTime: 3000,
            successRate: 0.75,
            costFactor: 0.8,
            useCases: ["browse pages", "scrape content", "interactive web"],
            dependencies: [],
            permissions: ["web"],
        },
    };

    return toolMetadata[toolId] || null;
}

/**
 * Select optimal tools for task
 */
export function selectToolsForTask(
    taskDescription: string,
    availableTools: string[],
    userPreferences?: { preferFast?: boolean; preferCheap?: boolean }
): Array<{ toolId: string; priority: number; reason: string }> {
    const analysis = analyzeTaskForTools(taskDescription);
    const selected: Array<{ toolId: string; priority: number; reason: string }> = [];

    // Score each available tool
    for (const toolId of availableTools) {
        const metadata = getToolMetadata(toolId);
        if (!metadata) continue;

        let score = 0;
        const reasons: string[] = [];

        // Match capabilities
        const capabilityMatch = metadata.useCases.some(useCase =>
            analysis.capabilities.some(cap => useCase.toLowerCase().includes(cap.toLowerCase()))
        );

        if (capabilityMatch) {
            score += 30;
            reasons.push("Matches task capabilities");
        }

        // Match task type
        if (metadata.useCases.some(useCase =>
            useCase.toLowerCase().includes(analysis.type.toLowerCase())
        )) {
            score += 20;
            reasons.push("Matches task type");
        }

        // Consider execution time
        if (analysis.timeSensitive) {
            if (metadata.avgExecutionTime < 500) {
                score += 15;
                reasons.push("Fast execution");
            } else {
                score -= 10;
                reasons.push("Slow execution");
            }
        }

        // Consider cost
        if (analysis.costSensitive || userPreferences?.preferCheap) {
            if (metadata.costFactor < 0.3) {
                score += 15;
                reasons.push("Low cost");
            } else {
                score -= 10;
                reasons.push("High cost");
            }
        }

        // Consider success rate
        if (metadata.successRate > 0.85) {
            score += 10;
            reasons.push("High success rate");
        }

        // Consider user preferences
        if (userPreferences?.preferFast && metadata.avgExecutionTime < 500) {
            score += 10;
            reasons.push("User prefers fast tools");
        }

        if (score > 0) {
            selected.push({
                toolId,
                priority: score,
                reason: reasons.join(", "),
            });
        }
    }

    // Sort by priority
    selected.sort((a, b) => b.priority - a.priority);

    log.info("Tool selection results", {
        task: taskDescription,
        selected: selected.map(s => `${s.toolId} (${s.priority})`),
    });

    return selected;
}

/**
 * Suggest tool for specific task
 */
export function suggestToolForTask(
    taskDescription: string,
    availableTools: string[]
): { toolId: string; reason: string; confidence: number } | null {
    const selections = selectToolsForTask(taskDescription, availableTools);

    if (selections.length === 0) {
        return null;
    }

    const best = selections[0];
    const confidence = Math.min(1, best.priority / 100);

    return {
        toolId: best.toolId,
        reason: best.reason,
        confidence,
    };
}

/**
 * Auto-select tool for task
 */
export function autoSelectTool(
    taskDescription: string,
    availableTools: string[]
): string | null {
    const suggestion = suggestToolForTask(taskDescription, availableTools);

    if (suggestion && suggestion.confidence > 0.7) {
        log.info(`Auto-selected tool: ${suggestion.toolId}`, {
            reason: suggestion.reason,
            confidence: suggestion.confidence,
        });
        return suggestion.toolId;
    }

    return null;
}
