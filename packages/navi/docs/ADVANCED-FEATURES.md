# Advanced Agent Features

This document describes the advanced features that make the navi agent more intelligent and capable.

## 🧠 Adaptive Thinking System

### Overview
The adaptive thinking system automatically adjusts the agent's reasoning effort based on task complexity, user preferences, and historical performance.

### Features

#### 1. Adaptive Thinking Level
- **Off**: No extended thinking (fastest, cheapest)
- **Think**: Standard thinking (balanced)
- **Max**: Maximum thinking (slower, more expensive)
- **Adaptive**: Automatically adjusts based on task complexity

#### 2. Task Complexity Analysis
Analyzes tasks based on:
- Message length and structure
- Keywords (complex vs. simple)
- Technical terms
- Sentence complexity
- Required capabilities

**Tools:**
- `analyze_task_complexity` - Analyze task complexity
- `get_adaptive_thinking` - Get adaptive thinking level
- `suggest_thinking_level` - Suggest thinking level change
- `auto_adjust_thinking` - Auto-adjust thinking level

**Usage:**
```typescript
// Analyze task complexity
const analysis = analyzeTaskComplexity("Implement a complex authentication system")
// Returns: { score: 85, recommendation: "max", factors: [...] }

// Get adaptive thinking level
const level = getAdaptiveThinkingLevel("Explain this code")
// Returns: "off" (simple task)

// Suggest thinking level
const suggestion = suggestThinkingLevel("Build a full-stack app", "off")
// Returns: { suggestion: "max", reason: "High complexity", confidence: 0.9 }
```

#### 3. User Pattern Learning
The system learns from your usage patterns:
- Average task completion time
- Preferred thinking level
- Success rates by thinking level
- Cost sensitivity

**Example:**
```json
{
  "thinkingPattern": {
    "avgCompletionTime": 45000,
    "preferredLevel": "think",
    "successRates": {
      "off": 0.7,
      "think": 0.85,
      "max": 0.9
    },
    "costSensitivity": 0.6
  }
}
```

### Adaptive Mode Behavior
When set to "adaptive":
1. Analyzes task complexity
2. Checks user preferences
3. Considers historical success rates
4. Recommends optimal thinking level
5. Auto-adjusts if confidence > 70%

## 🔐 Context-Aware Permission System

### Overview
Intelligently suggests permission mode changes based on task requirements and user behavior.

### Features

#### 1. Permission Mode Suggestions
Analyzes tasks to suggest optimal permission mode:
- **Safe Mode**: For exploration tasks
- **Ask Mode**: For development tasks
- **Allow-All Mode**: For batch operations

**Tools:**
- `suggest_permission_mode` - Suggest permission mode
- `suggest_permission_rules` - Suggest custom rules
- `auto_suggest_permission_mode` - Auto-suggest mode

**Usage:**
```typescript
// Suggest permission mode
const suggestion = suggestPermissionMode(
  "Explore the codebase structure",
  "ask",
  sessionId
)
// Returns: { suggestion: "safe", reason: "Exploration task", confidence: 0.8 }

// Suggest custom rules
const rules = suggestPermissionRules("/workspace/root")
// Returns: Array of suggested permission rules
```

#### 2. Context Analysis
The system analyzes:
- Task description keywords
- User's recent permission decisions
- Common patterns in workspace
- Time since last denial

#### 3. Custom Rule Suggestions
Automatically suggests permission rules based on usage:
- Common read commands (ls, pwd, cat, git status)
- MCP tool patterns (list, read, search)
- API endpoint patterns

**Example permissions.json:**
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
  "allowedMcpPatterns": ["list", "read", "search"],
  "allowedWritePaths": ["./src/**/*.ts"]
}
```

## 🔄 Intelligent Session Recovery

### Overview
AI-powered session recovery with summarization and context preservation.

### Features

#### 1. Context Analysis
Analyzes session messages to extract:
- Key files being worked on
- Tasks in progress
- User preferences learned
- Important context

**Tools:**
- `analyze_session_for_recovery` - Analyze session
- `get_recovery_prompt` - Get recovery prompt
- `suggest_recovery_actions` - Suggest recovery actions

**Usage:**
```typescript
// Analyze session for recovery
const context = analyzeSessionForRecovery(sessionId, 50)
// Returns: RecoveryContext with summary, files, tasks

// Get recovery prompt
const prompt = createRecoveryPrompt(context)
// Returns: System prompt for continuing session

// Suggest recovery actions
const actions = suggestRecoveryActions(context)
// Returns: Array of suggested actions
```

#### 2. Intelligent Summarization
- Token-based size detection
- Automatic summarization for large contexts
- Intent preservation
- Full context storage for reference

#### 3. Recovery Suggestions
Based on session state, suggests:
- Resume tasks in progress
- Review recently edited files
- Review learned preferences

**Example Recovery Context:**
```json
{
  "summary": "## Session Recovery Summary\n\n### Key Files:\n- src/auth/login.ts\n- src/auth/register.ts\n\n### Tasks in Progress:\n- Implement OAuth login\n- Add password validation",
  "keyFiles": ["src/auth/login.ts", "src/auth/register.ts"],
  "tasksInProgress": ["Implement OAuth login", "Add password validation"],
  "learnedPreferences": ["Prefers TypeScript", "Uses async/await"],
  "tokenCount": 250
}
```

## 🛠️ Dynamic Tool Selection

### Overview
Intelligently selects and prioritizes tools based on task requirements and historical performance.

### Features

#### 1. Task Analysis
Analyzes tasks to determine:
- Task type (read, write, execute, search, test)
- Required capabilities
- Complexity level
- Time and cost sensitivity

**Tools:**
- `select_tools_for_task` - Select optimal tools
- `suggest_tool_for_task` - Suggest best tool

**Usage:**
```typescript
// Select tools for task
const tools = selectToolsForTask(
  "Search for authentication functions",
  ["read", "grep", "codesearch", "websearch"]
)
// Returns: [{ toolId: "grep", priority: 85, reason: "Matches task capabilities" }]

// Suggest tool
const suggestion = suggestToolForTask(
  "Read the README file",
  ["read", "grep", "glob"]
)
// Returns: { toolId: "read", reason: "Matches task type", confidence: 0.9 }
```

#### 2. Tool Metadata
Each tool has metadata:
- Category (file, shell, search, web)
- Average execution time
- Success rate
- Cost factor
- Common use cases
- Required permissions

#### 3. Smart Selection
Considers:
- Task capability matching
- Execution time (for time-sensitive tasks)
- Cost (for cost-sensitive tasks)
- Success rate
- User preferences

## 🤝 Multi-Agent Collaboration

### Overview
Support for coordinating multiple agents to solve complex tasks.

### Features

#### 1. Agent Roles
- **Planner**: Architecture and task decomposition
- **Executor**: Implementation and coding
- **Reviewer**: Code review and quality assurance
- **Researcher**: Documentation and investigation
- **Debugger**: Troubleshooting and fixing

**Tools:**
- `suggest_collaboration` - Suggest collaboration
- `create_collaboration_plan` - Create collaboration plan

**Usage:**
```typescript
// Suggest collaboration
const suggestion = suggestCollaboration(
  "Build a full authentication system with OAuth",
  85
)
// Returns: { suggestion: "...", agents: ["planner", "executor", "reviewer"], confidence: 0.9 }

// Create collaboration plan
const plan = createCollaborationPlan(task, ["planner", "executor", "reviewer"])
// Returns: CollaborationTask with subtasks and agents
```

#### 2. Collaboration Planning
- Task decomposition into subtasks
- Agent assignment based on roles
- Dependency management
- Progress tracking

#### 3. Subtask Management
Each subtask has:
- Description
- Assigned agent
- Dependencies
- Status (pending, in-progress, completed, failed)
- Result

**Example Collaboration Plan:**
```json
{
  "id": "collab-1234567890",
  "description": "Build authentication system",
  "agents": [
    { "id": "agent-planner-0", "role": "planner", "thinkingLevel": "max" },
    { "id": "agent-executor-0", "role": "executor", "thinkingLevel": "think" },
    { "id": "agent-reviewer-0", "role": "reviewer", "thinkingLevel": "max" }
  ],
  "subtasks": [
    { "id": "subtask-0", "description": "Plan architecture", "assignedTo": "agent-planner-0", "status": "completed" },
    { "id": "subtask-1", "description": "Implement features", "assignedTo": "agent-executor-0", "status": "in-progress", "dependencies": ["subtask-0"] },
    { "id": "subtask-2", "description": "Review code", "assignedTo": "agent-reviewer-0", "status": "pending", "dependencies": ["subtask-1"] }
  ]
}
```

## 🎓 Learning from User Feedback

### Overview
Agent learns from interactions and feedback to improve performance over time.

### Features

#### 1. Feedback Analysis
Analyzes different types of feedback:
- **Positive**: What worked well
- **Negative**: What didn't work
- **Correction**: What should be different
- **Preference**: User's preferences

**Tools:**
- `generate_learning_summary` - View learned patterns
- `learn_from_task` - Learn from task completion
- `suggest_tool_from_learning` - Suggest tool based on learning

**Usage:**
```typescript
// Generate learning summary
const summary = generateLearningSummary()
// Returns: Summary of all learned patterns

// Learn from task
learnFromTaskCompletion(
  "Search for authentication functions",
  "grep",
  true,
  "Great, found exactly what I needed!"
)
// Stores learning pattern

// Suggest tool from learning
const suggestion = suggestToolFromLearning(
  "Search for user functions",
  ["grep", "codesearch", "websearch"]
)
// Returns: { toolId: "grep", reason: "Learned from 15 previous interactions", confidence: 0.9 }
```

#### 2. Pattern Storage
Learning patterns include:
- Type (positive, negative, correction, preference)
- Pattern (what was learned)
- Confidence (0-1)
- Usage count
- Success rate
- Last used timestamp

#### 3. Pattern Application
The agent applies learned patterns to:
- Tool selection
- Approach improvement
- Preference matching
- Avoiding mistakes

**Example Learning Patterns:**
```json
{
  "learningPatterns": [
    {
      "id": "learn-1234567890",
      "type": "positive",
      "pattern": "grep",
      "confidence": 0.9,
      "usageCount": 15,
      "successRate": 0.93,
      "lastUsed": 1234567890000
    },
    {
      "id": "learn-1234567891",
      "type": "preference",
      "pattern": "TypeScript",
      "confidence": 0.8,
      "usageCount": 8,
      "successRate": 1.0,
      "lastUsed": 1234567890000
    }
  ]
}
```

## 📊 Advanced Tool Reference

### Thinking Tools
| Tool | Description | Parameters |
|------|-------------|------------|
| `analyze_task_complexity` | Analyze task complexity | `task`, `context?` |
| `get_adaptive_thinking` | Get adaptive thinking level | `task`, `context?` |
| `suggest_thinking_level` | Suggest thinking level change | `task`, `currentLevel`, `context?` |
| `auto_adjust_thinking` | Auto-adjust thinking level | `task`, `currentLevel`, `context?` |

### Permission Tools
| Tool | Description | Parameters |
|------|-------------|------------|
| `suggest_permission_mode` | Suggest permission mode | `task`, `sessionId?` |
| `suggest_permission_rules` | Suggest custom rules | `workspaceRoot` |

### Recovery Tools
| Tool | Description | Parameters |
|------|-------------|------------|
| `analyze_session_for_recovery` | Analyze session | `sessionId`, `limit?` |
| `get_recovery_prompt` | Get recovery prompt | `sessionId` |
| `suggest_recovery_actions` | Suggest recovery actions | `sessionId` |

### Tool Selection Tools
| Tool | Description | Parameters |
|------|-------------|------------|
| `select_tools_for_task` | Select optimal tools | `task`, `availableTools` |
| `suggest_tool_for_task` | Suggest best tool | `task`, `availableTools` |

### Collaboration Tools
| Tool | Description | Parameters |
|------|-------------|------------|
| `suggest_collaboration` | Suggest collaboration | `task`, `complexity?` |
| `create_collaboration_plan` | Create collaboration plan | `task`, `agents` |

### Learning Tools
| Tool | Description | Parameters |
|------|-------------|------------|
| `generate_learning_summary` | View learned patterns | - |
| `learn_from_task` | Learn from task | `task`, `toolUsed`, `success`, `feedback?` |
| `suggest_tool_from_learning` | Suggest tool from learning | `task`, `availableTools` |

## 🎯 Usage Examples

### Example 1: Adaptive Thinking for Complex Task
```typescript
// User: "Build a full authentication system with OAuth"
const analysis = analyzeTaskComplexity(task)
// Returns: { score: 92, recommendation: "max" }

const level = getAdaptiveThinkingLevel(task)
// Returns: "max" (high complexity)

// Agent automatically uses max thinking
```

### Example 2: Permission Suggestion
```typescript
// User: "Explore the codebase"
const suggestion = suggestPermissionMode(task, sessionId)
// Returns: { suggestion: "safe", reason: "Exploration task", confidence: 0.8 }

// Agent suggests switching to Safe Mode
```

### Example 3: Tool Selection
```typescript
// User: "Search for authentication functions"
const tools = selectToolsForTask(task, ["read", "grep", "codesearch"])
// Returns: [{ toolId: "grep", priority: 85, reason: "Matches task capabilities" }]

// Agent uses grep tool
```

### Example 4: Multi-Agent Collaboration
```typescript
// User: "Build a complete e-commerce system"
const suggestion = suggestCollaboration(task, 90)
// Returns: { agents: ["planner", "executor", "reviewer"], confidence: 0.95 }

const plan = createCollaborationPlan(task, suggestion.agents)
// Returns: Collaboration plan with subtasks

// Multiple agents work together
```

### Example 5: Learning from Feedback
```typescript
// After successful task
learnFromTaskCompletion(
  "Search for functions",
  "grep",
  true,
  "Perfect, found exactly what I needed!"
)

// Later, when similar task
const suggestion = suggestToolFromLearning(
  "Search for user functions",
  ["grep", "codesearch"]
)
// Returns: { toolId: "grep", reason: "Learned from 15 previous interactions" }
```

## 📈 Benefits

1. **Efficiency**: Automatic optimization reduces manual configuration
2. **Accuracy**: Learning from feedback improves suggestions
3. **Safety**: Context-aware permissions prevent mistakes
4. **Scalability**: Multi-agent collaboration handles complex tasks
5. **Personalization**: User patterns make agent more helpful
6. **Reliability**: Session recovery preserves context

## 🔧 Configuration

### Enable Advanced Features
All advanced features are enabled by default. To customize:

1. **Adaptive Thinking**: Set thinking level to "adaptive"
2. **Permissions**: Create `permissions.json` in workspace
3. **Learning**: Feedback is automatically collected
4. **Collaboration**: Suggested automatically for complex tasks

### Disable Features
To disable specific features, remove tools from registry or add flags in config.

## 📚 References

- Adaptive Thinking: `src/agent/adaptive-thinking.ts`
- Permission Suggestions: `src/permission/suggestions.ts`
- Session Recovery: `src/session/intelligent-recovery.ts`
- Tool Selection: `src/agent/tool-selection.ts`
- Multi-Agent: `src/agent/multi-agent.ts`
- Learning: `src/agent/learning.ts`
