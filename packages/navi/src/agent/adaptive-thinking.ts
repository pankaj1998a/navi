/**
 * Adaptive Thinking Mode
 *
 * Automatically adjusts thinking level based on task complexity,
 * user preferences, and historical performance.
 */

import { Log } from "../util/log";
import { type ThinkingLevel, getThinkingTokens, cycleThinkingLevel } from "./thinking-levels";
import { loadPreferences } from "../config/preferences";

const log = Log.create({ service: "adaptive-thinking" });

/**
 * Task complexity analysis
 */
export interface TaskComplexity {
    /** Complexity score (0-100) */
    score: number;
    /** Factors contributing to complexity */
    factors: string[];
    /** Recommended thinking level */
    recommendation: ThinkingLevel;
    /** Whether the task is eligible for swarm orchestration */
    needsSwarm: boolean;
}

/**
 * Analysis of user's working pattern
 */
export interface UserPattern {
    /** Average task completion time (ms) */
    avgCompletionTime: number;
    /** Preferred thinking level */
    preferredLevel: ThinkingLevel;
    /** Success rate by thinking level */
    successRates: Record<ThinkingLevel, number>;
    /** Cost sensitivity (0-1, higher = more cost-conscious) */
    costSensitivity: number;
}

/**
 * Analyze task complexity based on message and context
 */
export function analyzeTaskComplexity(message: string, context?: string): TaskComplexity {
    const factors: string[] = [];
    let score = 0;

    // Message length analysis
    const wordCount = message.split(/\s+/).length;
    if (wordCount > 100) {
        factors.push("Long message (detailed requirements)");
        score += 20;
    } else if (wordCount < 10) {
        factors.push("Short message (simple request)");
        score -= 10;
    }

    // Keyword analysis for complexity
    const complexKeywords = [
        "implement", "create", "build", "develop", "design",
        "refactor", "migrate", "upgrade", "restructure",
        "add feature", "new feature", "integrate",
        "set up", "setup", "configure", "install",
        "multiple", "several", "all", "entire", "whole",
        "complex", "advanced", "sophisticated",
        "optimize", "performance", "security",
        "architecture", "design pattern", "algorithm",
    ];

    const simpleKeywords = [
        "explain", "describe", "what is", "how does",
        "read", "view", "look at", "show",
        "list", "find", "search",
        "simple", "easy", "basic",
    ];

    const messageLower = message.toLowerCase();

    // Check for complex keywords
    for (const keyword of complexKeywords) {
        if (messageLower.includes(keyword)) {
            factors.push(`Contains "${keyword}"`);
            score += 5;
        }
    }

    // Check for simple keywords
    for (const keyword of simpleKeywords) {
        if (messageLower.includes(keyword)) {
            factors.push(`Contains "${keyword}"`);
            score -= 5;
        }
    }

    // Sentence complexity
    const sentenceCount = message.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    if (sentenceCount > 5) {
        factors.push("Multiple sentences");
        score += 10;
    }

    // Technical terms count
    const technicalTerms = [
        "api", "endpoint", "database", "schema", "migration",
        "test", "unit test", "integration test",
        "deploy", "production", "staging",
        "docker", "kubernetes", "cloud",
        "async", "await", "promise", "callback",
        "class", "interface", "type", "generic",
    ];

    for (const term of technicalTerms) {
        if (messageLower.includes(term)) {
            factors.push(`Technical term: ${term}`);
            score += 3;
        }
    }

    // Swarm detection
    let needsSwarm = false;
    if (score >= 70 || factors.filter(f => f.includes("Technical term") || f.includes("Contains")).length > 10) {
        needsSwarm = true;
    }

    // Normalize score to 0-100
    score = Math.max(0, Math.min(100, 50 + score));

    // Determine recommendation
    let recommendation: ThinkingLevel;
    if (score >= 75) {
        recommendation = "max";
        factors.push("High complexity detected");
    } else if (score >= 50) {
        recommendation = "think";
        factors.push("Medium complexity detected");
    } else {
        recommendation = "off";
        factors.push("Low complexity detected");
    }
    return {
        score,
        factors,
        recommendation,
        needsSwarm,
    };
}

/**
 * Get adaptive thinking level based on task and user pattern
 */
export function getAdaptiveThinkingLevel(
    message: string,
    userPattern?: UserPattern,
    context?: string
): ThinkingLevel {
    const complexity = analyzeTaskComplexity(message, context);

    log.info("Task complexity analysis", {
        score: complexity.score,
        factors: complexity.factors,
        recommendation: complexity.recommendation,
    });

    // If we have user pattern data, adjust based on preferences
    if (userPattern) {
        const preferred = userPattern.preferredLevel;
        const costSensitivity = userPattern.costSensitivity;

        // If user prefers lower thinking level and task is medium complexity
        if (complexity.recommendation === "think" && preferred === "off" && complexity.score < 65) {
            log.info("Adjusting to user preference: off");
            return "off";
        }

        // If user is cost-sensitive and task is simple
        if (costSensitivity > 0.7 && complexity.score < 60) {
            log.info("Adjusting for cost sensitivity");
            return "off";
        }

        // If user has high success rate with current recommendation
        const successRate = userPattern.successRates[complexity.recommendation] || 0;
        if (successRate > 0.8) {
            log.info(`Using recommendation with high success rate: ${complexity.recommendation}`);
            return complexity.recommendation;
        }
    }

    return complexity.recommendation;
}

/**
 * Load user pattern from preferences and history
 */
export function loadUserPattern(): UserPattern | undefined {
    const prefs = loadPreferences();

    // Try to load from preferences if available
    if (prefs.thinkingPattern) {
        return {
            avgCompletionTime: prefs.thinkingPattern.avgCompletionTime || 30000,
            preferredLevel: (prefs.thinkingPattern.preferredLevel as ThinkingLevel) || "think",
            successRates: prefs.thinkingPattern.successRates || {
                off: 0.7,
                think: 0.8,
                max: 0.9,
            },
            costSensitivity: prefs.thinkingPattern.costSensitivity || 0.5,
        };
    }

    return undefined;
}

/**
 * Update user pattern based on task performance
 */
export function updateUserPattern(
    thinkingLevel: ThinkingLevel,
    success: boolean,
    durationMs: number
): void {
    const prefs = loadPreferences();

    if (!prefs.thinkingPattern) {
        prefs.thinkingPattern = {
            avgCompletionTime: 30000,
            preferredLevel: "think",
            successRates: { off: 0.7, think: 0.8, max: 0.9 },
            costSensitivity: 0.5,
            taskHistory: [],
        };
    }

    const pattern = prefs.thinkingPattern;

    // Update average completion time (exponential moving average)
    pattern.avgCompletionTime = pattern.avgCompletionTime * 0.9 + durationMs * 0.1;

    // Update success rate
    const currentRate = pattern.successRates[thinkingLevel];
    pattern.successRates[thinkingLevel] = currentRate * 0.9 + (success ? 0.1 : 0);

    // Update preferred level based on success
    if (success && durationMs < pattern.avgCompletionTime * 0.8) {
        // Task completed faster than average, prefer this level
        pattern.preferredLevel = thinkingLevel;
    }

    // Update cost sensitivity based on thinking level usage
    const usageRatio = {
        off: 0,
        think: 0,
        max: 0,
    };

    // Track task history (last 100 tasks)
    pattern.taskHistory = pattern.taskHistory || [];
    pattern.taskHistory.push({
        level: thinkingLevel,
        success,
        duration: durationMs,
        timestamp: Date.now(),
    });

    if (pattern.taskHistory.length > 100) {
        pattern.taskHistory.shift();
    }

    // Calculate cost sensitivity based on usage
    const recentTasks = pattern.taskHistory.slice(-20);
    const maxCount = recentTasks.filter(t => t.level === "max").length;
    pattern.costSensitivity = maxCount / 20;

    // Save updated pattern
    const { updatePreferences } = require("../config/preferences");
    updatePreferences({ thinkingPattern: pattern });
}

/**
 * Suggest thinking level to user
 */
export function suggestThinkingLevel(
    message: string,
    currentLevel: ThinkingLevel,
    context?: string
): { suggestion: ThinkingLevel; reason: string; confidence: number } {
    const complexity = analyzeTaskComplexity(message, context);
    const userPattern = loadUserPattern();

    // Get adaptive recommendation
    const adaptive = getAdaptiveThinkingLevel(message, userPattern, context);

    // If current level matches adaptive, no suggestion needed
    if (currentLevel === adaptive) {
        return {
            suggestion: currentLevel,
            reason: "Current level is optimal for this task",
            confidence: 1.0,
        };
    }

    // Determine reason
    let reason = "";
    if (complexity.score >= 75 && currentLevel !== "max") {
        reason = "This is a complex task that benefits from maximum thinking";
    } else if (complexity.score >= 50 && currentLevel === "off") {
        reason = "This task has medium complexity, thinking mode recommended";
    } else if (complexity.score < 50 && currentLevel === "max") {
        reason = "This is a simple task, thinking mode may be overkill";
    }

    // Calculate confidence based on complexity score
    const confidence = Math.min(1, Math.abs(complexity.score - 50) / 50);

    return {
        suggestion: adaptive,
        reason,
        confidence,
    };
}

/**
 * Auto-adjust thinking level based on task
 */
export function autoAdjustThinkingLevel(
    currentLevel: ThinkingLevel,
    message: string,
    context?: string
): { adjusted: ThinkingLevel; reason: string } {
    const suggestion = suggestThinkingLevel(message, currentLevel, context);

    if (suggestion.confidence > 0.7 && suggestion.suggestion !== currentLevel) {
        log.info(`Auto-adjusting thinking level: ${currentLevel} → ${suggestion.suggestion}`, {
            reason: suggestion.reason,
            confidence: suggestion.confidence,
        });

        return {
            adjusted: suggestion.suggestion,
            reason: suggestion.reason,
        };
    }

    return {
        adjusted: currentLevel,
        reason: "No adjustment needed",
    };
}
