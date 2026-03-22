/**
 * Permission Module Exports
 *
 * Centralized exports for all permission-related functionality.
 */

// Mode types and configuration
export {
    PermissionMode,
    PERMISSION_MODE_ORDER,
    PERMISSION_MODE_CONFIG,
    SAFE_MODE_CONFIG,
    PatternSchema,
    PatternWithComment,
    ApiEndpointRuleSchema,
    ApiEndpointRule,
    PermissionsConfigSchema,
    PermissionsConfigFile,
    CompiledBashPattern,
    CompiledApiEndpointRule,
    MismatchAnalysis,
    ModeConfig,
} from "./mode-types";

// Mode manager
export {
    getPermissionMode,
    setPermissionMode,
    cyclePermissionMode,
    initializeModeState,
    cleanupModeState,
    modeManager,
    type ModeState,
    type ModeStateCallbacks,
} from "./mode-manager";

// Permissions config
export {
    parsePermissionsJson,
    validatePermissionsConfig,
    getWorkspacePermissionsPath,
    loadWorkspacePermissionsConfig,
    permissionsConfigCache,
    type PermissionsCustomConfig,
    type MergedPermissionsConfig,
} from "./permissions-config";

// Bash validator
export {
    validateBashCommand,
    type BashValidationResult,
    type BashValidationReason,
} from "./bash-validator";

// Main permission namespace
export { Permission } from "./index";
