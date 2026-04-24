/**
 * Context-Aware Permission Suggestions
 *
 * Analyzes user behavior and task context to suggest
 * permission mode changes and custom rules.
 */

import { Log } from "../util/log";
import { type PermissionMode, PERMISSION_MODE_CONFIG } from "./mode-types";
import { getPermissionMode } from "./mode-manager";
import { loadWorkspacePermissionsConfig, permissionsConfigCache } from "./permissions-config";
import { Instance } from "../project/instance";

const log = Log.create({ service: "permission-suggestions" });

/**
 * Permission usage pattern
 */
export interface PermissionPattern {
    /** Total permission requests */
    totalRequests: number;
    /** Requests by mode */
    requestsByMode: Record<PermissionMode, number>;
    /** Average approval rate */
    approvalRate: number;
    /** Most frequently requested tools */
    frequentTools: string[];
    /** Last denied tool */
    lastDenied?: string;
    /** Timestamp of last request */
    lastRequest?: number;
}

/**
 * Analyze permission usage and suggest improvements
 */
export function analyzePermissionUsage(sessionID: string): PermissionPattern {
    // In a real implementation, this would query permission history
    // For now, return a mock pattern
    return {
        totalRequests: 0,
        requestsByMode: { safe: 0, ask: 0, "allow-all": 0 },
        approvalRate: 0.8,
        frequentTools: [],
    };
}

/**
 * Suggest permission mode based on task and history
 */
export function suggestPermissionMode(
    taskDescription: string,
    currentMode: PermissionMode,
    sessionID: string
): { suggestion: PermissionMode; reason: string; confidence: number } {
    const pattern = analyzePermissionUsage(sessionID);
    const taskLower = taskDescription.toLowerCase();

    // Analyze task for permission requirements
    const requiresWrite = /write|edit|create|implement|add|modify|change/i.test(taskLower);
    const requiresRead = /read|view|look|explain|describe|show/i.test(taskLower);
    const isExploration = /explore|understand|learn|discover|find/i.test(taskLower);
    const isBatch = /multiple|several|all|batch|automate/i.test(taskLower);

    let suggestion: PermissionMode = currentMode;
    let reason = "";
    let confidence = 0.5;

    // If task requires writes and we're in safe mode
    if (requiresWrite && currentMode === "safe") {
        suggestion = "ask";
        reason = "Task requires write operations";
        confidence = 0.9;
    }

    // If task is exploration only
    if (isExploration && !requiresWrite) {
        suggestion = "safe";
        reason = "Exploration task - read-only mode recommended";
        confidence = 0.8;
    }

    // If task is batch and user has high approval rate
    if (isBatch && pattern.approvalRate > 0.9 && currentMode === "ask") {
        suggestion = "allow-all";
        reason = "Batch task with high approval history";
        confidence = 0.7;
    }

    // If user frequently denies the same tool
    if (pattern.lastDenied) {
        const lastDeniedTime = pattern.lastRequest || 0;
        const timeSinceLastDenial = Date.now() - lastDeniedTime;
        
        if (timeSinceLastDenial < 60000) { // Within last minute
            suggestion = "safe";
            reason = `User recently denied "${pattern.lastDenied}" - switching to safe mode`;
            confidence = 0.85;
        }
    }

    log.info("Permission mode suggestion", {
        current: currentMode,
        suggestion,
        reason,
        confidence,
        task: taskDescription,
    });

    return { suggestion, reason, confidence };
}

/**
 * Suggest custom permission rules based on usage patterns
 */
export function suggestPermissionRules(
    workspaceRootPath: string
): Array<{ type: string; pattern: string; reason: string }> {
    const suggestions: Array<{ type: string; pattern: string; reason: string }> = [];
    const currentConfig = loadWorkspacePermissionsConfig(workspaceRootPath);

    // Analyze common patterns that could be allowed
    const commonReadCommands = [
        { pattern: "^ls(\\s+.*)?$", reason: "List files (common read operation)" },
        { pattern: "^pwd(\\s+.*)?$", reason: "Print working directory" },
        { pattern: "^cat(\\s+.*)?$", reason: "View file contents" },
        { pattern: "^git\\s+(status|log|diff|show|branch|remote|rev-parse)(\\s+.*)?$", reason: "Read-only git commands" },
    ];

    // Check if these patterns are already in config
    for (const cmd of commonReadCommands) {
        const alreadyConfigured = currentConfig?.allowedBashPatterns.some(p => 
            typeof p === "string" ? p === cmd.pattern : p.pattern === cmd.pattern
        );

        if (!alreadyConfigured) {
            suggestions.push({
                type: "bash",
                pattern: cmd.pattern,
                reason: cmd.reason,
            });
        }
    }

    // Suggest MCP patterns based on common tools
    const commonMcpPatterns = [
        { pattern: "list", reason: "List resources (common operation)" },
        { pattern: "read", reason: "Read resources (common operation)" },
        { pattern: "search", reason: "Search resources (common operation)" },
    ];

    for (const mcp of commonMcpPatterns) {
        const alreadyConfigured = currentConfig?.allowedMcpPatterns.includes(mcp.pattern);
        
        if (!alreadyConfigured) {
            suggestions.push({
                type: "mcp",
                pattern: mcp.pattern,
                reason: mcp.reason,
            });
        }
    }

    log.info("Permission rule suggestions", {
        count: suggestions.length,
        suggestions: suggestions.map(s => `${s.type}: ${s.pattern}`),
    });

    return suggestions;
}

/**
 * Suggest permission mode change to user
 */
export function suggestPermissionChange(
    sessionID: string,
    taskDescription: string
): { message: string; options: Array<{ mode: PermissionMode; label: string; reason: string }> } | null {
    const currentMode = getPermissionMode(sessionID);
    const suggestion = suggestPermissionMode(taskDescription, currentMode, sessionID);

    if (suggestion.suggestion === currentMode) {
        return null;
    }

    const config = PERMISSION_MODE_CONFIG[suggestion.suggestion];

    return {
        message: `Based on your task, I suggest switching to ${config.displayName} mode.\n\nReason: ${suggestion.reason}\nConfidence: ${(suggestion.confidence * 100).toFixed(0)}%`,
        options: [
            {
                mode: suggestion.suggestion,
                label: `Switch to ${config.displayName}`,
                reason: suggestion.reason,
            },
            {
                mode: currentMode,
                label: `Keep ${PERMISSION_MODE_CONFIG[currentMode].displayName}`,
                reason: "User prefers current mode",
            },
        ],
    };
}

/**
 * Auto-suggest permission mode based on task
 */
export function autoSuggestPermissionMode(
    sessionID: string,
    taskDescription: string
): PermissionMode | null {
    const suggestion = suggestPermissionMode(taskDescription, getPermissionMode(sessionID), sessionID);
    
    if (suggestion.confidence > 0.8 && suggestion.suggestion !== getPermissionMode(sessionID)) {
        log.info(`Auto-suggesting permission mode: ${suggestion.suggestion}`, {
            reason: suggestion.reason,
            confidence: suggestion.confidence,
        });
        
        return suggestion.suggestion;
    }

    return null;
}



