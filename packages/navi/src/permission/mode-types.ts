import { z } from "zod"

/**
 * Available permission modes
 * - 'safe': Read-only, blocks writes, never prompts (green)
 * - 'ask': Prompts for dangerous operations (amber)
 * - 'allow-all': Everything allowed, no prompts (violet)
 */
export type PermissionMode = "safe" | "ask" | "allow-all"

/**
 * Order of modes for cycling with keyboard shortcuts
 */
export const PERMISSION_MODE_ORDER: PermissionMode[] = ["safe", "ask", "allow-all"]

/**
 * Pattern with optional comment
 */
export const PatternSchema = z.union([
    z.string(),
    z.object({
        pattern: z.string(),
        comment: z.string().optional(),
    }),
])

export type PatternWithComment = z.infer<typeof PatternSchema>

/**
 * API endpoint rule - method + path pattern
 */
export const ApiEndpointRuleSchema = z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    path: z.string().describe("Regex pattern for API path"),
    comment: z.string().optional(),
})

export type ApiEndpointRule = z.infer<typeof ApiEndpointRuleSchema>

/**
 * Permissions JSON configuration schema
 */
export const PermissionsConfigSchema = z.object({
    /** Bash command patterns to allow (regex strings) */
    allowedBashPatterns: z.array(PatternSchema).optional(),
    /** MCP tool patterns to allow (regex strings) */
    allowedMcpPatterns: z.array(PatternSchema).optional(),
    /** API endpoint rules - method + path pattern */
    allowedApiEndpoints: z.array(ApiEndpointRuleSchema).optional(),
    /** File paths to allow writes in Safe Mode (glob patterns) */
    allowedWritePaths: z.array(PatternSchema).optional(),
    /** Additional tools to block (extends the hardcoded defaults) */
    blockedTools: z.array(PatternSchema).optional(),
    /** Tool-specific restrictions mapping tool name to array of allowed glob patterns. */
    toolRestrictions: z.record(z.array(z.string())).optional(),
})

export type PermissionsConfigFile = z.infer<typeof PermissionsConfigSchema>

/**
 * Compiled bash pattern with metadata for error messages.
 */
export interface CompiledBashPattern {
    /** Compiled regex for matching */
    regex: RegExp
    /** Original pattern string (for error messages) */
    source: string
    /** Human-readable comment explaining what this pattern allows */
    comment?: string
}

/**
 * Compiled API endpoint rule for runtime checking
 */
export interface CompiledApiEndpointRule {
    method: string
    pathPattern: RegExp
}

/**
 * Analysis of why a command didn't match a pattern.
 */
export interface MismatchAnalysis {
    /** How much of the command matched before failure */
    matchedPrefix: string
    /** Character position where matching stopped */
    failedAtPosition: number
    /** The token/word that caused the mismatch */
    failedToken: string
    /** The pattern that got closest to matching */
    bestMatchPattern?: {
        source: string
        comment?: string
    }
    /** Actionable suggestion for the user/agent */
    suggestion?: string
}

/**
 * Safe mode configuration - defines behavior for read-only mode
 */
export interface ModeConfig {
    /** Tools that are always blocked in safe mode (Write, Edit, etc.) - hardcoded, not configurable */
    blockedTools: Set<string>
    /** Read-only Bash command patterns with metadata for helpful error messages */
    readOnlyBashPatterns: CompiledBashPattern[]
    /** Read-only MCP patterns (tools matching these are allowed) */
    readOnlyMcpPatterns: RegExp[]
    /** Fine-grained API endpoint rules (method + path pattern) */
    allowedApiEndpoints: CompiledApiEndpointRule[]
    /** File paths allowed for writes in Safe Mode (glob patterns) */
    allowedWritePaths?: string[]
    /** User-friendly name */
    displayName: string
    /** Keyboard shortcut hint */
    shortcutHint: string
}

/**
 * Safe Mode Configuration (pure data)
 */
export const SAFE_MODE_CONFIG: ModeConfig = {
    // Tools that are always blocked (no read-only variant) - these are hardcoded
    // as they represent fundamental write operations that should never be allowed
    // in Safe Mode regardless of user configuration
    blockedTools: new Set([
        "write",
        "edit",
        "multiedit",
        "document-writer",
    ]),
    // Empty fallbacks - actual patterns loaded from permissions.json
    readOnlyBashPatterns: [],
    readOnlyMcpPatterns: [],
    allowedApiEndpoints: [],
    displayName: "Safe Mode",
    shortcutHint: "Ctrl+X M",
}

/**
 * Display configuration for each mode
 */
export const PERMISSION_MODE_CONFIG: Record<PermissionMode, {
    displayName: string
    shortName: string
    description: string
    colorClass: {
        text: string
        bg: string
        border: string
    }
}> = {
    'safe': {
        displayName: 'Explore',
        shortName: 'Explore',
        description: 'Read-only exploration. Blocks writes, never prompts.',
        colorClass: {
            text: 'text-green-600',
            bg: 'bg-green-600',
            border: 'border-green-600',
        },
    },
    'ask': {
        displayName: 'Ask to Edit',
        shortName: 'Ask',
        description: 'Prompts before making edits.',
        colorClass: {
            text: 'text-yellow-600',
            bg: 'bg-yellow-600',
            border: 'border-yellow-600',
        },
    },
    'allow-all': {
        displayName: 'Execute',
        shortName: 'Execute',
        description: 'Automatic execution, no prompts.',
        colorClass: {
            text: 'text-purple-600',
            bg: 'bg-purple-600',
            border: 'border-purple-600',
        },
    },
}



