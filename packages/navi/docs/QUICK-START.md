# Quick Start Guide - New Features

## 🚀 Permission Modes

### What are they?
Three levels of control over agent actions:
- **Safe Mode (Explore)**: Read-only, blocks writes, never prompts
- **Ask Mode (Ask to Edit)**: Prompts before making edits
- **Allow-All Mode (Execute)**: Auto-approves all commands

### How to use?

#### Via Tools (Agent can use them)
```
# Get current mode
permission_mode_get()

# Set mode
permission_mode_set({ mode: "safe" })

# Cycle to next mode
permission_mode_cycle()
```

#### Via Keyboard (TUI)
```
Ctrl+X M  - Cycle through permission modes
```

### Example Workflow
```bash
# Start in Ask mode (default)
navi

# Switch to Safe mode for exploration
# Press Ctrl+X M or tell agent: "Switch to safe mode"

# Explore codebase safely
# Agent can only read files, run read-only commands

# Switch to Allow-All for batch operations
# Press Ctrl+X M again or tell agent: "Switch to allow-all mode"

# Agent can now execute without prompts
# (except explicitly blocked tools)
```

## ⚡ Thinking Levels

### What are they?
Control over reasoning effort vs. cost:
- **Off**: No extended thinking (fastest, cheapest)
- **Think**: Standard thinking (balanced)
- **Max**: Maximum thinking (slower, more expensive)

### How to use?
Tell the agent:
```
"Use thinking level: off"
"Use thinking level: think"
"Use thinking level: max"
"Boost thinking for this task"
```

### Token Usage (Claude 3.5 Sonnet)
- Off: 0 tokens
- Think: 2,048 tokens (~$0.03)
- Max: 16,384 tokens (~$0.24)

## 👤 User Preferences

### What are they?
Persistent personalization data:
- Name, timezone, location
- Language preferences
- Notes about you

### How to set?
Tell the agent:
```
"My name is John Doe"
"I'm in New York, USA"
"My timezone is America/New_York"
"I prefer TypeScript over JavaScript"
```

Or update manually:
```bash
# Edit ~/.navi/preferences.json
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

### How it helps?
Agent remembers your preferences across sessions:
- Uses your name in responses
- Considers your timezone
- Respects your language preferences
- Remembers your notes

## 📝 Custom Permissions

### What is it?
Customize which commands are allowed in each mode.

### How to set?
Create `permissions.json` in your workspace root:

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
  "allowedWritePaths": [
    "./src/**/*.ts",
    "./docs/**/*.md"
  ]
}
```

### Examples

#### Allow specific git commands
```json
{
  "allowedBashPatterns": [
    "^git\\s+(status|log|diff|show|branch|remote|rev-parse)(\\s+.*)?$"
  ]
}
```

#### Allow MCP tools from specific source
```json
{
  "allowedMcpPatterns": [
    "list",
    "read",
    "search"
  ]
}
```

#### Allow writes to specific paths
```json
{
  "allowedWritePaths": [
    "./src/**/*.ts",
    "./docs/**/*.md",
    "./tests/**/*.ts"
  ]
}
```

## 🔍 Config Validation

### What is it?
Automatic validation of config files to prevent errors.

### How it works?
- Config files are validated when changed
- Invalid configs trigger warnings
- Permissions cache is auto-invalidated

### Validation Types
- **permissions.json**: Validates patterns and rules
- **skills/**: Validates skill markdown format
- **statuses/config.json**: Validates status structure
- **sources/**/config.json**: Validates source config

### Manual Validation
```typescript
import { validateConfigFile } from "@/config/validators"

const result = validateConfigFile(
  "/path/to/permissions.json",
  "/workspace/root"
)
console.log(result)
```

## 📊 Large Response Handling

### What is it?
Automatic summarization of large tool responses.

### How it works?
- Responses > 60,000 tokens are summarized
- Full results stored for later retrieval
- Intent preserved in summary

### Example
```bash
# Agent runs a tool that returns huge output
# Automatically summarized to ~42,000 tokens
# Full output available if needed
```

## 🎯 Best Practices

### 1. Start with Safe Mode
```bash
# Explore new codebase
Ctrl+X M → Safe Mode
# Read files, run read-only commands
```

### 2. Use Ask Mode for Development
```bash
# Default mode - safe for most tasks
# Prompts before making changes
```

### 3. Use Allow-All for Batch Operations
```bash
# When you trust the agent
Ctrl+X M → Allow-All Mode
# Run multiple operations without interruptions
```

### 4. Set User Preferences Early
```bash
# Tell agent about yourself
"My name is John"
"I'm in New York"
# Agent will remember and use this info
```

### 5. Customize Permissions for Your Workflow
```bash
# Create permissions.json in workspace
# Allow commands you use frequently
# Block tools you never want to use
```

### 6. Use Thinking Levels Wisely
```bash
# Off: Simple tasks, quick responses
# Think: Most development tasks
# Max: Complex problem solving
```

## 🚨 Troubleshooting

### Permission Denied in Safe Mode
**Problem**: Command blocked in Safe Mode
**Solution**: 
1. Switch to Ask or Allow-All mode
2. Or add command to `permissions.json`

### Config Validation Error
**Problem**: Invalid config file
**Solution**:
1. Check syntax (JSON format)
2. Validate patterns are valid regex
3. Restart navi

### Preferences Not Saving
**Problem**: Preferences not persisting
**Solution**:
1. Check `~/.navi/preferences.json` exists
2. Ensure file is writable
3. Restart navi

### Large Response Truncated
**Problem**: Tool output is summarized
**Solution**:
1. This is normal for large outputs
2. Full output stored internally
3. Use specific tools to get details

## 📚 More Information

See `features-from-craft-agents.md` for detailed documentation.
