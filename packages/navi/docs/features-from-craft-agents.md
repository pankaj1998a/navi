# Features from Craft-Agents

This document describes the features copied from the craft-agents project to navi, along with usage instructions.

## 🎯 Implemented Features

### 1. Enhanced Permission Modes

**Location:** `src/permission/`

**Features:**
- **Safe Mode (Explore)**: Read-only mode, blocks all write operations, never prompts
- **Ask Mode (Ask to Edit)**: Prompts for dangerous operations before execution
- **Allow-All Mode (Execute)**: Auto-approves all commands (except explicitly blocked ones)

**Usage:**
```typescript
// Get current permission mode
import { getPermissionMode } from "@/permission"
const mode = getPermissionMode(sessionId)

// Set permission mode
import { setPermissionMode } from "@/permission"
setPermissionMode(sessionId, "safe")

// Cycle to next mode
import { cyclePermissionMode } from "@/permission"
const newMode = cyclePermissionMode(sessionId)
```

**Tools Available:**
- `permission_mode_get`: Get current permission mode
- `permission_mode_set`: Set permission mode (safe/ask/allow-all)
- `permission_mode_cycle`: Cycle to next permission mode

**Keyboard Shortcuts (TUI):**
- `Ctrl+X M`: Cycle through permission modes

**Configuration:**
Create `permissions.json` in your workspace root to customize allowed commands:

```json
{
  "allowedBashPatterns": [
    "^ls(\\s+.*)?$",
    "^pwd(\\s+.*)?$",
    {
      "pattern": "^git\\s+(status|log|diff|show|branch|remote|rev-parse)(\\s+.*)?$",
      "comment": "Read-only git commands"
    }
  ],
  "allowedMcpPatterns": [
    "list",
    "read"
  ],
  "allowedApiEndpoints": [
    {
      "method": "GET",
      "path": "^/api/.*$",
      "comment": "Allow GET requests to API"
    }
  ],
  "allowedWritePaths": [
    "./src/**/*.ts",
    "./docs/**/*.md"
  ],
  "blockedTools": [
    "dangerous-tool"
  ]
}
```

### 2. Config Validation

**Location:** `src/config/validators.ts`

**Features:**
- Real-time validation of configuration files
- Prevents invalid configs from breaking the agent
- Validates: permissions.json, skills, statuses, sources

**Usage:**
```typescript
import { validateConfigFile, detectConfigFileType, validateConfigFileContent } from "@/config/validators"

// Validate a config file
const result = validateConfigFile("/path/to/permissions.json", "/workspace/root")
console.log(result)

// Validate content directly
const fileType = detectConfigFileType("/path/to/permissions.json", "/workspace/root")
if (fileType) {
  const result = validateConfigFileContent(fileType, content)
  console.log(result.valid ? "Valid" : result.errors)
}
```

**Automatic Validation:**
- Config files are automatically validated when changed
- Invalid configs trigger warnings in the log
- Permissions cache is invalidated on successful validation

### 3. Thinking Levels

**Location:** `src/agent/thinking-levels.ts`

**Features:**
- **Off**: No extended thinking (fastest, cheapest)
- **Think**: Standard thinking (balanced)
- **Max**: Maximum thinking tokens (slower, more expensive)

**Usage:**
```typescript
import { getThinkingTokens, cycleThinkingLevel, getThinkingLevelName } from "@/agent/thinking-levels"

// Get tokens for current thinking level
const tokens = getThinkingTokens("think", "claude-3-5-sonnet-latest")

// Cycle to next thinking level
const newLevel = cycleThinkingLevel("think")

// Get display name
const name = getThinkingLevelName("max")
```

**Model Support:**
- Claude 3.5 Sonnet: 0 / 2048 / 16384 tokens
- Claude 3 Opus: 0 / 2048 / 16384 tokens
- Claude 3 Haiku: 0 / 1024 / 4096 tokens
- Default: 0 / 2048 / 8192 tokens

### 4. User Preferences

**Location:** `src/config/preferences.ts`

**Features:**
- Persistent user preferences stored at `~/.navi/preferences.json`
- Personalization for name, timezone, location, language
- Notes that accumulate over time
- Automatically injected into system prompts

**Usage:**
```typescript
import { loadPreferences, updatePreferences, formatPreferencesForPrompt } from "@/config/preferences"

// Load preferences
const prefs = loadPreferences()

// Update preferences
updatePreferences({
  name: "John Doe",
  timezone: "America/New_York",
  location: { city: "New York", country: "USA" },
  language: "English",
  notes: "Prefers TypeScript over JavaScript"
})

// Format for system prompt
const prompt = formatPreferencesForPrompt()
```

**Example Preferences File (`~/.navi/preferences.json`):**
```json
{
  "name": "John Doe",
  "timezone": "America/New_York",
  "location": {
    "city": "New York",
    "country": "USA"
  },
  "language": "English",
  "notes": "- Prefers TypeScript over JavaScript\n- Uses VS Code as editor"
}
```

### 5. Large Response Handling

**Location:** `src/util/summarize.ts`

**Features:**
- Token-based size detection (limit: ~60,000 tokens)
- Intelligent truncation for large tool responses
- Full results stored for later retrieval

**Usage:**
```typescript
import { estimateTokens, summarizeLargeResult, storeFullResponse } from "@/util/summarize"

// Estimate tokens
const estimate = estimateTokens(largeText)
if (estimate.exceedsLimit) {
  console.log(`Text exceeds limit (${estimate.tokens} tokens)`)
}

// Summarize large response
const summary = summarizeLargeResult(largeResponse, "User requested code analysis")

// Store full response for later
const referenceId = storeFullResponse(sessionId, toolUseId, fullResponse)
```

**Token Limit:** ~60,000 tokens (configurable via `TOKEN_LIMIT`)

### 6. Config File Watcher

**Location:** `src/config/watcher.ts`

**Features:**
- Hot-reload for config changes
- Watches for permissions, skills, statuses, and sources changes
- Triggers callbacks on changes
- Invalidates caches automatically

**Usage:**
```typescript
import { createConfigWatcher, ConfigWatcher } from "@/config/watcher"

// Create watcher
const watcher = createConfigWatcher("/workspace/root", {
  onPermissionsChange: () => {
    console.log("Permissions config changed")
  },
  onSkillsChange: () => {
    console.log("Skills config changed")
  },
  onValidationError: (file, errors) => {
    console.error(`Validation error in ${file}:`, errors)
  }
})

// Stop watcher
watcher.stop()
```

### 7. Enhanced Permission System

**Location:** `src/permission/`

**Features:**
- JSON-based permission configuration
- Pattern-based bash/MCP/API endpoint rules
- Workspace-level permissions.json support
- Configurable allowlists with comments

**Usage:**
See "Enhanced Permission Modes" section above for configuration details.

## 📁 New Files Added

### Permission Module
- `src/permission/mode-types.ts` - Permission mode types and configuration
- `src/permission/mode-manager.ts` - Centralized mode management
- `src/permission/permissions-config.ts` - JSON config parsing and caching
- `src/permission/exports.ts` - Centralized exports
- `src/tool/permission-mode.ts` - Tools for managing permission modes

### Config Module
- `src/config/validators.ts` - Config file validation
- `src/config/watcher.ts` - Config file watcher
- `src/config/preferences.ts` - User preferences management

### Agent Module
- `src/agent/thinking-levels.ts` - Thinking level management

### Util Module
- `src/util/summarize.ts` - Large response handling

## 🔄 Integration Points

### Session Integration
The permission modes are integrated into the existing session system:
- Each session has its own permission mode
- Modes persist across session lifecycle
- Cleanup happens automatically on session end

### Tool Integration
New tools added to the registry:
- `permission_mode_get` - Get current mode
- `permission_mode_set` - Set mode
- `permission_mode_cycle` - Cycle to next mode

### Permission Integration
The enhanced permission system integrates with existing `Permission.ask()`:
- Checks permission mode before prompting
- Auto-approves in "allow-all" mode
- Validates against configured patterns in "safe" mode
- Blocks explicitly configured tools in all modes

## 🎨 UI/UX Considerations

### TUI Display
For the terminal interface, consider displaying:
- Current permission mode in header
- Thinking level indicator
- Active sources count

### Keyboard Shortcuts
- `Ctrl+X M`: Cycle permission modes
- `Ctrl+X T`: Change theme (existing)
- `Ctrl+P`: Command palette (existing)

## 📝 Configuration Files

### permissions.json (Workspace Root)
```json
{
  "allowedBashPatterns": [
    "^ls(\\s+.*)?$",
    "^pwd(\\s+.*)?$",
    {
      "pattern": "^git\\s+(status|log|diff|show|branch|remote|rev-parse)(\\s+.*)?$",
      "comment": "Read-only git commands"
    }
  ],
  "allowedMcpPatterns": [
    "list",
    "read"
  ],
  "allowedApiEndpoints": [
    {
      "method": "GET",
      "path": "^/api/.*$"
    }
  ],
  "allowedWritePaths": [
    "./src/**/*.ts"
  ],
  "blockedTools": []
}
```

### preferences.json (User Config)
```json
{
  "name": "John Doe",
  "timezone": "America/New_York",
  "location": {
    "city": "New York",
    "country": "USA"
  },
  "language": "English",
  "notes": "- Prefers TypeScript\n- Uses VS Code"
}
```

## 🔧 Future Enhancements

### Planned
1. **Labels System** - Hierarchical tagging for sessions
2. **Dynamic Views** - Filtrex-based session filtering
3. **Enhanced Sources** - Comprehensive MCP/API integration
4. **Plan System** - Task planning and review workflow
5. **Session Recovery** - Enhanced session recovery mechanisms

### Considerations
- Add TUI indicators for current mode/thinking level
- Implement full long_responses/ storage for large responses
- Add more model-specific thinking token configurations
- Integrate with existing session status system

## 📚 References

- Craft-Agents GitHub: https://github.com/lukilabs/craft-agents-oss
- Original implementation: `packages/shared/src/` directory
- Permission modes: `agent/mode-types.ts`, `agent/mode-manager.ts`
- Config validation: `config/validators.ts`
- Thinking levels: `agent/thinking-levels.ts`
- User preferences: `config/preferences.ts`
- Large response handling: `utils/summarize.ts`
