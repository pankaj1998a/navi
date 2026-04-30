# Codebase Map - Fast Issue Localization

Generated: 2026-04-29  
Repository: packages/navi (Navi - Interactive CLI Tool)  
Parent Project: AutoBE + Warp ecosystem

## 📋 Overview

This document provides a staged, hierarchical map of the Navi codebase for rapid issue localization. Navigate from high-level architecture down to specific files and symbols.

**Repository Structure:**

```
packages/navi/          (Current repo - Interactive CLI tool)
├── src/                # Main source code
├── agents/             # Agent implementations
├── skills/             # Specialized skill workflows
└── tools/              # Tool definitions

packages/app/           (Frontend application)
packages/core/          (Core shared libraries)
packages/enterprise/    (Enterprise features)
packages/ui/            # Shared UI components
```

---

## Stage 1: High-Level Overview

### Core Purpose

Navi is an **interactive CLI tool** that helps users with software engineering tasks through:

- Agent orchestration and tool execution
- Codebase analysis and navigation
- Interactive problem-solving workflows
- Skill-based task automation

### What Problem Does This Solve?

1. **Complex task decomposition** - Breaking down engineering tasks into actionable steps
2. **Rapid codebase navigation** - Finding relevant files, symbols, and patterns quickly
3. **Context-aware assistance** - Providing targeted help based on the current code state
4. **Automated workflows** - Pre-built skills for common tasks (feature flags, telemetry, reviews, etc.)

### Primary Entry Points

| Command          | Purpose                  | File Location  |
| ---------------- | ------------------------ | -------------- |
| `navi`           | Main CLI entry           | `src/index.ts` |
| `navi --help`    | Command listing          | `src/index.ts` |
| `navi <command>` | Execute specific command | `src/cli/cmd/` |

### Key Architecture Decisions

1. **Monorepo Structure** - Multiple related packages in a unified workspace
2. **Tool-based Architecture** - Discrete tools for specific operations (Bash, Read, Write, etc.)
3. **Agent System** - Specialized agents for different task types (bug-buster, architect, test-engineer, etc.)
4. **Skill Framework** - Reusable workflows packaged as skills
5. **TypeScript-first** - Full type safety with Zod validation
6. **Stateful Sessions** - Persistent context across interactions

---

## Stage 2: Architecture Deep Dive

### Directory Structure

```
packages/navi/
├── src/
│   ├── cli/              # CLI command implementations
│   ├── agent/            # Agent system (core orchestration)
│   ├── tools/            # Tool definitions and utilities
│   ├── skills/           # Built-in skill definitions
│   ├── server/           # Server/API endpoints
│   └── util/             # Shared utilities
├── agents/               # Agent implementations
├── skills/               # Custom skill workflows
├── tools/                # External tool scripts
└── commands/             # Command definitions
```

### Critical Paths by Functionality

#### CLI Command System

- **Location:** `src/cli/cmd/`
- **Key Files:** Command definitions for each subcommand
- **What to look for:** Command-line argument parsing, command orchestration
- **Hotspots:** Argument validation errors, command conflicts

#### Agent System

- **Location:** `src/agent/`, `agents/`
- **Key Files:** `agent-supervisor.ts`, `autonomous-loop.ts`
- **What to look for:** Agent lifecycle, tool execution, state management
- **Hotspots:** Memory leaks, infinite loops, tool permission issues

#### Tool Framework

- **Location:** `src/tools/`, `tools/`
- **Key Files:** Tool definitions, execution context
- **What to look for:** Tool validation, security boundaries
- **Hotspots:** Permission violations, tool conflicts

#### Skills Framework

- **Location:** `src/skills/`, `skills/`
- **Key Files:** `SKILL.md` files in each skill directory
- **What to look for:** Workflow orchestration, agent coordination
- **Hotspots:** Skill dependencies, execution order issues

#### Server/API Layer

- **Location:** `src/server/`
- **Key Files:** `server.ts`, route handlers
- **What to look for:** API contract violations, serialization errors
- **Hotspots:** CORS issues, authentication failures

### Data Flow Architecture

```
User Input
    ↓
CLI Parser (src/index.ts)
    ↓
Command Router (src/cli/cmd/)
    ↓
Agent Selection (src/agent/)
    ↓
Tool Execution (src/tools/)
    ↓
State Update (src/util/state.ts)
    ↓
Response Generation
    ↓
User Output
```

### External Dependencies

**Critical Libraries:**

- **yargs** - CLI argument parsing
- **TypeScript** - Type system and compilation
- **Bun** - Runtime and package management
- **Zod** - Schema validation
- **OpenTUI** - Terminal UI components
- **@navi-ai/sdk** - Server communication

**Build System:**

- **Turborepo** - Monorepo build orchestration
- **esbuild** - Fast TypeScript compilation

---

## Stage 3: Key Files & Symbols

### Core Entry Point

**File:** `src/index.ts`  
**Purpose:** Main CLI entry point and command dispatcher  
**Key Functions:**

- `isLightweightStartupRequest()` - Fast path for help/version
- Lazy command loading - Prevents full agent system load
- Command registry - Maps command names to modules

**Bug Hotspots:**

- Command loading failures (module not found)
- Circular dependencies in lazy loading
- Argument parsing edge cases

---

### CLI Commands Directory

**Path:** `src/cli/cmd/`  
**Total Files:** 40+ command files  
**Key Commands:**

| Command   | File            | Purpose               |
| --------- | --------------- | --------------------- |
| `tui`     | `tui/thread.ts` | Terminal UI interface |
| `agent`   | `agent.ts`      | Agent management      |
| `mcp`     | `mcp.ts`        | MCP server management |
| `run`     | `run.ts`        | Execute workflows     |
| `debug`   | `debug.ts`      | Debug tools           |
| `github`  | `github.ts`     | GitHub integration    |
| `session` | `session.ts`    | Session management    |

**Hotspots:**

- `github.ts` (59KB) - Complex GitHub API interactions
- `mcp.ts` (26KB) - MCP protocol implementation
- `run.ts` (22KB) - Workflow execution engine
- `auth.ts` (17KB) - Authentication flows

---

### Agent System

**Path:** `agents/`  
**Total Files:** 30+ agent files  
**Core Agents:**

| Agent                     | File                       | Responsibility          |
| ------------------------- | -------------------------- | ----------------------- |
| **agent-supervisor**      | `agent-supervisor.ts`      | Orchestrates all agents |
| **autonomous-loop**       | `autonomous-loop.ts`       | Self-directed execution |
| **codebase-investigator** | `codebase-investigator.ts` | Code analysis           |
| **local-executor**        | `local-executor.ts`        | Shell command execution |
| **master-agent**          | `master-agent.ts`          | Primary decision maker  |
| **registry**              | `registry.ts`              | Agent/tool registration |

**Key Symbols:**

- `AgentSupervisor` - Main orchestrator class
- `AutonomousLoop` - Self-running agent loop
- `AgentRegistry` - Agent discovery and loading
- `ToolRegistry` - Tool discovery and permissions

**Hotspots:**

- Memory management in long-running agents
- Tool permission boundaries
- Inter-agent communication deadlocks
- Registry loading failures

---

### Tool Framework

**Path:** `tools/` (external), `src/tools/` (internal)  
**Tool Categories:**

1. **Execution Tools** - Run commands, manage processes
   - `terminal` - Shell execution
   - `repl` - Interactive code evaluation
2. **File System Tools** - File operations
   - `read` - File reading
   - `write` - File writing
   - `edit` - Text replacement
   - `glob` - Pattern matching
   - `grep` - Content search

3. **Code Analysis Tools** - Code intelligence
   - `lsp` - Language Server Protocol
   - `codesearch` - API/library search

4. **Agent Tools** - Multi-agent workflows
   - `task` - Launch subagents
   - `parallel` - Parallel execution
   - `team_create` - Agent teams

5. **State Tools** - Session management
   - `save_memory` - Persistent storage
   - `scratchpad` - Session notes
   - `todowrite` - Task tracking

**Hotspots:**

- Tool permission validation
- File system access boundaries
- Command injection vulnerabilities
- State synchronization issues

---

### Skills Framework

**Path:** `skills/`  
**Total Skills:** 80+ specialized workflows  
**Categories:**

| Category               | Example Skills                                                |
| ---------------------- | ------------------------------------------------------------- |
| **Feature Management** | `add-feature-flag`, `promote-feature`, `remove-feature-flag`  |
| **Code Review**        | `pr-review`, `github-pr-comments`, `resolve-conflicts`        |
| **Testing**            | `test-driven-development`, `rust-unit-tests`, `test-scenario` |
| **Planning**           | `create-plan`, `writing-plans`, `spec-driven-implementation`  |
| **Debugging**          | `systematic-debugging`, `fix-errors`, `diagnose-ci-failures`  |
| **Architecture**       | `feature-dev`, `interface-schema`, `database-schema`          |

**Key Skills:**

- `feature-dev` - 7-phase feature development workflow
- `pr-review` - Comprehensive PR review with specialized agents
- `fix-errors` - Build error and test failure resolution
- `spec-driven-implementation` - Product → Tech spec → Implementation

**Hotspots:**

- Skill dependency resolution
- Agent coordination in complex skills
- State management across skill steps

---

### Server/API Layer

**Path:** `src/server/`  
**Key Files:**

- `server.ts` - Main server setup
- `routes/` - API route handlers
- `experimental.ts` - Experimental endpoints

**API Contracts:**

- SDK communication (`@navi-ai/sdk`)
- Tool execution endpoints
- State synchronization
- File system operations

**Hotspots:**

- SDK version compatibility
- Authentication/authorization
- Request validation
- Error handling consistency

---

### Configuration Files

**Critical Configs:**

| File               | Purpose               | Hotspot Issues                  |
| ------------------ | --------------------- | ------------------------------- |
| `package.json`     | Dependencies, scripts | Version conflicts, missing deps |
| `tsconfig.json`    | TypeScript config     | Compilation errors, strictness  |
| `turbo.json`       | Turborepo config      | Build cache, pipeline ordering  |
| `eslint.config.js` | Linting rules         | Code style violations           |
| `bunfig.toml`      | Bun runtime config    | Runtime behavior                |

---

## Stage 4: Bug Hotspots & Where to Look First

### By Symptom

#### 🔴 **Command Not Found / CLI Errors**

**Look Here First:**

1. `src/index.ts` - Main entry point
2. `src/cli/cmd/<command>.ts` - Specific command file
3. `package.json` - Script definitions

**Common Issues:**

- Missing command registration
- Import path errors
- Argument parser misconfiguration

---

#### 🔴 **Agent Won't Start / Crashes**

**Look Here First:**

1. `agents/agent-supervisor.ts` - Orchestrator
2. `agents/registry.ts` - Agent loading
3. `agents/<agent-name>.ts` - Specific agent

**Common Issues:**

- Circular dependencies in agent imports
- Missing tool permissions
- Memory exhaustion
- Unhandled promise rejections

---

#### 🔴 **Tool Execution Fails**

**Look Here First:**

1. `src/tools/` - Tool definitions
2. `tools/<tool-name>.ts` - External tools
3. Terminal/shell permission checks

**Common Issues:**

- Permission boundaries
- Command injection prevention
- Working directory context
- Environment variable access

---

#### 🔴 **Skill Workflow Broken**

**Look Here First:**

1. `skills/<skill-name>/SKILL.md` - Skill definition
2. `agents/` - Agent implementations
3. Skill-specific files

**Common Issues:**

- Step ordering dependencies
- State not persisted between steps
- Agent coordination failures
- Missing prerequisites

---

#### 🔴 **Build/Compilation Errors**

**Look Here First:**

1. `tsconfig.json` - TypeScript config
2. `turbo.json` - Build pipeline
3. `package.json` - Dependencies

**Common Issues:**

- Type definition mismatches
- Missing transitive dependencies
- Build cache corruption
- Circular module dependencies

---

#### 🔴 **API/Server Communication Failures**

**Look Here First:**

1. `src/server/` - Server endpoints
2. `src/server/routes/` - Route handlers
3. SDK version compatibility

**Common Issues:**

- Request/response type mismatches
- Authentication token expiration
- CORS configuration
- Payload size limits

---

#### 🔴 **State/Data Persistence Issues**

**Look Here First:**

1. `src/util/storage.ts` - Storage utilities
2. `src/util/state.ts` - State management
3. `agents/` - Agent state handling

**Common Issues:**

- Race conditions in state updates
- Storage serialization errors
- Memory vs. persistent storage confusion
- Session timeout handling

---

#### 🔴 **Performance Issues / Timeouts**

**Look Here First:**

1. `agents/autonomous-loop.ts` - Loop controls
2. `tools/local-executor.ts` - Command execution
3. Build pipeline configs

**Common Issues:**

- Infinite loops in agent logic
- Unbounded recursion
- Missing timeouts on external commands
- Memory leaks in long-running processes

---

### Recent Changes (Active Development)

**Files Modified Recently:**

- `src/cli/cmd/tui/` - Terminal UI components (multiple files)
- `src/server/routes/experimental.ts` - New API endpoints
- Various theme and UI component files

**Files Added Recently:**

- `src/cli/cmd/tui/component/glass-box.tsx` - New UI component
- `src/cli/cmd/tui/context/theme/Navi-Premium.json` - Theme config

**Focus Areas:**

- TUI improvements
- Theme system
- UI components
- Server routes

---

## 🔍 Quick Reference: Where to Start

| Issue Type            | First File to Check          | Second File               | Third File           |
| --------------------- | ---------------------------- | ------------------------- | -------------------- |
| **CLI command fails** | `src/index.ts`               | `src/cli/cmd/<cmd>.ts`    | `package.json`       |
| **Agent error**       | `agents/agent-supervisor.ts` | `agents/<agent>.ts`       | `agents/registry.ts` |
| **Tool permission**   | `src/tools/*.ts`             | `agents/<agent>.ts`       | `tools/*.ts`         |
| **Skill broken**      | `skills/<skill>/SKILL.md`    | `agents/*.ts`             | Skill-specific files |
| **Build failure**     | `tsconfig.json`              | `turbo.json`              | `package.json`       |
| **API error**         | `src/server/server.ts`       | `src/server/routes/*`     | SDK types            |
| **State lost**        | `src/util/storage.ts`        | `src/util/state.ts`       | Agent state files    |
| **Performance**       | `agents/autonomous-loop.ts`  | `tools/local-executor.ts` | Build config         |

---

## 🔄 Workflow Patterns

### Typical Issue Resolution Flow

1. **Identify Symptom** → Match to category above
2. **Check Primary File** → First file in hotspot list
3. **Check Logs** → Console/error output
4. **Check State** → Current system state, configs
5. **Isolate Component** → Reproduce in isolation
6. **Fix & Verify** → Apply fix, run tests
7. **Update Map** → Document new findings

### Testing Strategy

**Unit Tests:**

- Location: `*.test.ts` files alongside source
- Run: `bun test <file>`

**Integration Tests:**

- Location: `test/` directory
- Agent tests: `agents/*.test.ts`
- Run: `bun test`

**Type Checking:**

- Command: `bun run typecheck`

**Linting:**

- Command: `npm run lint`

---

## 📊 Repository Health

### Current Status Indicators

- **Main Branch:** `dev` (not `main`)
- **Build System:** Turborepo with caching
- **Runtime:** Bun (not Node.js)
- **Type Strictness:** High (TypeScript strict mode)
- **Test Coverage:** Extensive (300+ test files)

### Key Metrics

- **Total Source Files:** 100+ (navi package)
- **Total Agents:** 30+
- **Total Tools:** 20+
- **Total Skills:** 80+
- **Test Files:** 300+
- **CLI Commands:** 40+

---

## 🚨 Emergency Contacts & Resources

### Documentation

- **README:** `README.md` - Project overview
- **AGENTS.md:** `AGENTS.md` - Agent guidelines
- **.ai/ARCHITECTURE.md** - Detailed architecture
- **.ai/\*.md** - System documentation (15+ files)

### Issue Tracking

- **GitHub Issues:** Use `create-github-issue` skill
- **PR Reviews:** Use `pr-review` skill
- **Bug Reports:** File with reproduction steps

### Support Channels

- Run `navi --help` for command listing
- Check `.ai/` directory for detailed docs
- Review `AGENTS.md` for contribution guidelines

---

## 📝 Maintenance Notes

### Keeping This Map Updated

1. **When adding new command:** Update Stage 2 and Stage 3 sections
2. **When creating new agent:** Add to "Agent System" table
3. **When adding new tool:** Add to "Tool Framework" section
4. **When creating new skill:** Add to "Skills Framework" table
5. **When fixing recurring issue:** Add to "Bug Hotspots" section

### Last Updated

- **Date:** 2026-04-29
- **By:** Automated codebase analysis
- **Changes Since Last Update:** See git log
- **Files Changed:** 34 files (see git status)

---

## 🎯 Quick Start for New Contributors

### First-Time Setup

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Run tests
bun test

# Run development mode
bun dev
```

### Common Tasks

```bash
# Add new command
# 1. Create src/cli/cmd/<name>.ts
# 2. Register in src/index.ts
# 3. Add tests

# Add new agent
# 1. Create agents/<name>.ts
# 2. Extend BaseAgent
# 3. Register in agents/registry.ts

# Add new tool
# 1. Create tools/<name>.ts
# 2. Implement Tool interface
# 3. Add to registry

# Add new skill
# 1. Create skills/<name>/SKILL.md
# 2. Define workflow
# 3. Test with sample tasks
```

### Best Practices

1. **Always add tests** for new functionality
2. **Keep tools focused** - one responsibility per tool
3. **Document agents** with clear purpose and examples
4. **Use type safety** - leverage TypeScript fully
5. **Handle errors** - never let agents crash unexpectedly
6. **Respect boundaries** - tools should not exceed permissions
7. **Update docs** - keep CODEBASE_MAP.md current

---

_End of Codebase Map_

**Generated from:** packages/navi  
**Map Version:** 1.0  
**Next Review:** After major feature additions
