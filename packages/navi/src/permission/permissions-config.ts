/**
 * Safe Mode Configuration
 *
 * Allows customization of Safe Mode rules per workspace.
 * Users can create permissions.json files to extend the default rules.
 *
 * File locations:
 * - Workspace: {workspaceRootPath}/permissions.json
 *
 * Rules are additive - custom configs extend the defaults (more permissive).
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Log } from "../util/log";
import {
    SAFE_MODE_CONFIG,
    PermissionsConfigSchema,
    type ApiEndpointRule,
    type PermissionsConfigFile,
    type CompiledApiEndpointRule,
    type CompiledBashPattern,
    type PatternWithComment,
} from "./mode-types";

const log = Log.create({ service: "permissions-config" });

// ============================================================
// Types
// ============================================================

/**
 * Parsed and normalized permissions configuration
 */
export interface PermissionsCustomConfig {
    /** Additional bash patterns to allow (with optional comments for error messages) */
    allowedBashPatterns: PatternWithComment[];
    /** Additional MCP patterns to allow (as regex strings) */
    allowedMcpPatterns: string[];
    /** API endpoint rules for fine-grained control */
    allowedApiEndpoints: ApiEndpointRule[];
    /** File paths to allow writes in Safe Mode (glob pattern strings) */
    allowedWritePaths: string[];
    /** Tool-specific restrictions (tool => globs) */
    toolRestrictions: Record<string, string[]>;
}

/**
 * Merged permissions config for runtime use
 */
export interface MergedPermissionsConfig {
    /** Blocked tools (Write, Edit, MultiEdit, NotebookEdit) - hardcoded, not configurable */
    blockedTools: Set<string>;
    /** Read-only bash patterns with metadata for helpful error messages */
    readOnlyBashPatterns: CompiledBashPattern[];
    readOnlyMcpPatterns: RegExp[];
    /** Fine-grained API endpoint rules */
    allowedApiEndpoints: CompiledApiEndpointRule[];
    /** File paths allowed for writes in Safe Mode (glob patterns) */
    allowedWritePaths: string[];
    /** Tool-specific restrictions mapping tool name to array of allowed glob patterns. */
    toolRestrictions: Record<string, string[]>;
    /** Display name for error messages */
    displayName: string;
    /** Keyboard shortcut hint */
    shortcutHint: string;
}

// ============================================================
// JSON Parser
// ============================================================

/**
 * Parse and validate permissions.json file
 */
export function parsePermissionsJson(content: string): PermissionsCustomConfig {
    const emptyConfig: PermissionsCustomConfig = {
        allowedBashPatterns: [],
        allowedMcpPatterns: [],
        allowedApiEndpoints: [],
        allowedWritePaths: [],
        toolRestrictions: {},
    };

    try {
        const json = JSON.parse(content);
        const result = PermissionsConfigSchema.safeParse(json);

        if (!result.success) {
            log.warn("Validation errors:", result.error.issues);
            for (const issue of result.error.issues) {
                log.warn(`  - ${issue.path.join('.')}: ${issue.message}`);
            }
            return emptyConfig;
        }

        const data = result.data;

        // Normalize patterns (extract string from pattern objects, but NOT for bash - preserve comments)
        const normalizePatterns = (patterns: Array<string | { pattern: string; comment?: string }> | undefined): string[] => {
            if (!patterns) return [];
            return patterns.map(p => typeof p === 'string' ? p : p.pattern);
        };

        // For bash patterns, preserve comments for helpful error messages
        const normalizeBashPatterns = (patterns: Array<string | { pattern: string; comment?: string }> | undefined): PatternWithComment[] => {
            if (!patterns) return [];
            return patterns.map(p => {
                if (typeof p === 'string') {
                    return { pattern: p };
                }
                return { pattern: p.pattern, comment: p.comment };
            });
        };

        return {
            allowedBashPatterns: normalizeBashPatterns(data.allowedBashPatterns),
            allowedMcpPatterns: normalizePatterns(data.allowedMcpPatterns),
            allowedApiEndpoints: data.allowedApiEndpoints ?? [],
            allowedWritePaths: normalizePatterns(data.allowedWritePaths),
            toolRestrictions: (data.toolRestrictions as Record<string, string[]>) ?? {},
        };
    } catch (error) {
        log.error("JSON parse error:", { error });
        return emptyConfig;
    }
}

/**
 * Validate a regex pattern string, return null if invalid
 */
function validateRegex(pattern: string): RegExp | null {
    try {
        return new RegExp(pattern);
    } catch {
        return null;
    }
}

/**
 * Validate permissions config and return errors
 */
export function validatePermissionsConfig(config: PermissionsConfigFile): string[] {
    const errors: string[] = [];

    // Validate regex patterns
    const checkPatterns = (patterns: Array<string | { pattern: string }> | undefined, name: string) => {
        if (!patterns) return;
        for (let i = 0; i < patterns.length; i++) {
            const p = patterns[i];
            if (!p) continue;
            const patternStr = typeof p === 'string' ? p : p.pattern;
            if (!validateRegex(patternStr)) {
                errors.push(`${name}[${i}]: Invalid regex pattern: ${patternStr}`);
            }
        }
    };

    checkPatterns(config.allowedBashPatterns, 'allowedBashPatterns');
    checkPatterns(config.allowedMcpPatterns, 'allowedMcpPatterns');

    // Validate API endpoint patterns
    if (config.allowedApiEndpoints) {
        for (let i = 0; i < config.allowedApiEndpoints.length; i++) {
            const rule = config.allowedApiEndpoints[i];
            if (rule && !validateRegex(rule.path)) {
                errors.push(`allowedApiEndpoints[${i}].path: Invalid regex pattern: ${rule.path}`);
            }
        }
    }

    return errors;
}

// ============================================================
// Storage Functions
// ============================================================

/**
 * Get path to workspace permissions.json
 */
export function getWorkspacePermissionsPath(workspaceRootPath: string): string {
    return join(workspaceRootPath, 'permissions.json');
}

/**
 * Load workspace-level permissions config
 */
export function loadWorkspacePermissionsConfig(workspaceRootPath: string): PermissionsCustomConfig | null {
    const path = getWorkspacePermissionsPath(workspaceRootPath);
    if (!existsSync(path)) return null;

    try {
        const content = readFileSync(path, 'utf-8');
        const config = parsePermissionsJson(content);
        log.info(`Loaded workspace config from ${path}:`, config);
        return config;
    } catch (error) {
        log.error(`Error loading workspace config:`, { error });
        return null;
    }
}

// ============================================================
// Config Cache
// ============================================================

/**
 * In-memory cache for parsed permissions configs
 */
class PermissionsConfigCache {
    private workspaceConfigs: Map<string, PermissionsCustomConfig | null> = new Map();
    private mergedConfigs: Map<string, MergedPermissionsConfig> = new Map();

    /**
     * Get or load workspace config
     */
    getWorkspaceConfig(workspaceRootPath: string): PermissionsCustomConfig | null {
        if (!this.workspaceConfigs.has(workspaceRootPath)) {
            this.workspaceConfigs.set(workspaceRootPath, loadWorkspacePermissionsConfig(workspaceRootPath));
        }
        return this.workspaceConfigs.get(workspaceRootPath) ?? null;
    }

    /**
     * Invalidate workspace config
     */
    invalidateWorkspace(workspaceRootPath: string): void {
        log.info(`Invalidating workspace config: ${workspaceRootPath}`);
        this.workspaceConfigs.delete(workspaceRootPath);
        // Clear all merged configs for this workspace
        for (const key of this.mergedConfigs.keys()) {
            if (key.startsWith(`${workspaceRootPath}::`)) {
                this.mergedConfigs.delete(key);
            }
        }
    }

    /**
     * Get merged config for a workspace
     * Uses additive merging: custom configs extend defaults
     */
    getMergedConfig(workspaceRootPath: string): MergedPermissionsConfig {
        const cacheKey = workspaceRootPath;

        if (!this.mergedConfigs.has(cacheKey)) {
            const merged = this.buildMergedConfig(workspaceRootPath);
            this.mergedConfigs.set(cacheKey, merged);
        }

        return this.mergedConfigs.get(cacheKey)!;
    }

    private buildMergedConfig(workspaceRootPath: string): MergedPermissionsConfig {
        const defaults = SAFE_MODE_CONFIG;

        // Start with hardcoded fallback defaults (blocked tools are fixed, display settings)
        const merged: MergedPermissionsConfig = {
            blockedTools: new Set(defaults.blockedTools),
            readOnlyBashPatterns: [...defaults.readOnlyBashPatterns],
            readOnlyMcpPatterns: [...defaults.readOnlyMcpPatterns],
            allowedApiEndpoints: [],
            allowedWritePaths: [],
            toolRestrictions: {},
            displayName: defaults.displayName,
            shortcutHint: defaults.shortcutHint,
        };

        // Load and apply workspace-level customizations
        const wsConfig = this.getWorkspaceConfig(workspaceRootPath);
        if (wsConfig) {
            this.applyCustomConfig(merged, wsConfig);
        }

        return merged;
    }

    private applyCustomConfig(merged: MergedPermissionsConfig, custom: PermissionsCustomConfig): void {
        // Add allowed bash patterns (making config more permissive)
        for (const patternEntry of custom.allowedBashPatterns) {
            const pattern = typeof patternEntry === 'string' ? patternEntry : patternEntry.pattern;
            const comment = typeof patternEntry === 'string' ? undefined : patternEntry.comment;
            const regex = validateRegex(pattern);
            if (regex) {
                merged.readOnlyBashPatterns.push({
                    regex,
                    source: pattern,
                    comment: comment,
                });
            } else {
                log.warn(`Invalid bash pattern, skipping: ${pattern}`);
            }
        }

        // Add allowed MCP patterns
        for (const pattern of custom.allowedMcpPatterns) {
            const regex = validateRegex(pattern);
            if (regex) {
                merged.readOnlyMcpPatterns.push(regex);
            } else {
                log.warn(`Invalid MCP pattern, skipping: ${pattern}`);
            }
        }

        // Add allowed API endpoints (fine-grained)
        for (const rule of custom.allowedApiEndpoints) {
            const pathRegex = validateRegex(rule.path);
            if (pathRegex) {
                merged.allowedApiEndpoints.push({
                    method: rule.method,
                    pathPattern: pathRegex,
                });
            } else {
                log.warn(`Invalid API endpoint path pattern, skipping: ${rule.path}`);
            }
        }

        // Add allowed write paths (glob patterns, stored as strings)
        for (const pattern of custom.allowedWritePaths) {
            merged.allowedWritePaths.push(pattern);
        }

        // Add tool restrictions mapping
        for (const [tool, patterns] of Object.entries(custom.toolRestrictions)) {
            if (!merged.toolRestrictions[tool]) {
                merged.toolRestrictions[tool] = [];
            }
            merged.toolRestrictions[tool].push(...patterns);
        }
    }

    /**
     * Clear all cached configs
     */
    clear(): void {
        this.workspaceConfigs.clear();
        this.mergedConfigs.clear();
    }
}

// Singleton instance
export const permissionsConfigCache = new PermissionsConfigCache();



