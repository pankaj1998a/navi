/**
 * Config File Validation
 *
 * Real-time validation of configuration files to prevent invalid configs
 * from breaking the agent.
 */

import { Log } from "../util/log";
import { existsSync, readFileSync } from "fs";
import { permissionsConfigCache, validatePermissionsConfig } from "../permission/permissions-config";

const log = Log.create({ service: "config-validators" });

/**
 * Type of configuration file
 */
export type ConfigFileType = "permissions" | "skills" | "statuses" | "sources";

/**
 * Validation issue with a config file
 */
export interface ValidationIssue {
    type: string;
    message: string;
    path?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: ValidationIssue[];
}

/**
 * Detect config file type from path
 */
export function detectConfigFileType(filePath: string, workspaceRootPath: string): ConfigFileType | null {
    const relativePath = filePath.replace(workspaceRootPath + "/", "");
    
    if (relativePath === "permissions.json") {
        return "permissions";
    }
    
    if (relativePath.startsWith("skills/") && relativePath.endsWith("/SKILL.md")) {
        return "skills";
    }
    
    if (relativePath === "statuses/config.json") {
        return "statuses";
    }
    
    if (relativePath.startsWith("sources/") && relativePath.endsWith("/config.json")) {
        return "sources";
    }
    
    return null;
}

/**
 * Validate config file content based on type
 */
export function validateConfigFileContent(fileType: ConfigFileType, content: string): ValidationResult {
    const result: ValidationResult = {
        valid: true,
        errors: [],
    };

    try {
        switch (fileType) {
            case "permissions":
                const errors = validatePermissionsConfig(JSON.parse(content));
                if (errors.length > 0) {
                    result.valid = false;
                    result.errors = errors.map(e => ({ type: "validation_error", message: e }));
                }
                break;
            
            case "skills":
                // Validate skill markdown format
                if (!content.includes("# Skill") && !content.includes("## Description")) {
                    result.valid = false;
                    result.errors.push({
                        type: "format_error",
                        message: "Skill file must contain '# Skill' and '## Description' headers",
                    });
                }
                break;
            
            case "statuses":
                // Validate status config JSON structure
                const statusJson = JSON.parse(content);
                if (!statusJson.statuses || !Array.isArray(statusJson.statuses)) {
                    result.valid = false;
                    result.errors.push({
                        type: "format_error",
                        message: "Status config must have a 'statuses' array",
                    });
                }
                break;
            
            case "sources":
                // Validate source config JSON structure
                const sourceJson = JSON.parse(content);
                if (!sourceJson.type || !sourceJson.slug) {
                    result.valid = false;
                    result.errors.push({
                        type: "format_error",
                        message: "Source config must have 'type' and 'slug' fields",
                    });
                }
                break;
        }
    } catch (error) {
        result.valid = false;
        result.errors.push({
            type: "parse_error",
            message: error instanceof Error ? error.message : String(error),
        });
    }

    return result;
}

/**
 * Format validation result for display
 */
export function formatValidationResult(result: ValidationResult): string {
    if (result.valid) {
        return "✓ Configuration is valid";
    }

    const lines = ["✗ Configuration has errors:"];
    for (const error of result.errors) {
        lines.push(`  - ${error.message}`);
    }
    return lines.join("\n");
}

/**
 * Validate a config file and return formatted result
 */
export function validateConfigFile(filePath: string, workspaceRootPath: string): string | null {
    const fileType = detectConfigFileType(filePath, workspaceRootPath);
    if (!fileType) {
        return null;
    }

    if (!existsSync(filePath)) {
        return null;
    }

    try {
        const content = readFileSync(filePath, "utf-8");
        const result = validateConfigFileContent(fileType, content);
        
        // Invalidate cache if validation passes
        if (result.valid && fileType === "permissions") {
            permissionsConfigCache.invalidateWorkspace(workspaceRootPath);
        }
        
        return formatValidationResult(result);
    } catch (error) {
        return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
    }
}
