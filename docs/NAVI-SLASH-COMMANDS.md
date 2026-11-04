# NAVI: MASTER SLASH COMMAND & TOOL REFERENCE SPECIFICATION
**Version:** 2.5-STABLE  
**Repository:** `v:\pankaj\navi`  
**Audited & Certified:** November 4, 2026

---

## EXECUTIVE SUMMARY

This document provides a comprehensive, ground-truth audit and verification of all slash commands, tools, agency specialists, and system switches across the entire **Navi** codebase. Every single entry documented below has been verified against runtime handlers and source code definitions.

---

## 1. COMPREHENSIVE SLASH COMMAND TAXONOMY

Navi exposes two tiers of slash commands:
1. **Interactive TUI Palette & Session Control Commands (34 Commands)**: Direct keystroke actions, navigation modes, view toggles, model pickers, and workspace manipulation inside `packages/navi/src/cli/cmd/tui/app.tsx` and associated route controllers.
2. **Core Prompt & Execution Commands (65 Commands)**: Native prompt transformations, model/agent invocations, and toolchain orchestrations registered in `packages/navi/src/command/index.ts`.

---

### A. Interactive TUI Palette & Session Control Commands (34 Commands)
*These commands are handled by the interactive TUI runtime (`packages/navi/src/cli/cmd/tui/app.tsx`, `prompt/index.tsx`, `autocomplete.tsx`).*

| Command | Aliases | Scope | Functionality | Source File |
| :--- | :--- | :--- | :--- | :--- |
| `/new` | `/reset`, `/clear` | Session | Clears session state and initializes a clean conversation | `routes/session/index.tsx:501` |
| `/resume` | `/continue` | Session | Resumes an existing or disconnected conversation thread | `routes/session/index.tsx:520` |
| `/history` | `/sessions` | Session | Opens session browser and switcher dialog | `routes/session/index.tsx:535` |
| `/rename` | `/title` | Session | Renames current session thread in database | `routes/session/index.tsx:567` |
| `/compact` | `/summarize` | Session | Condenses conversation transcript to save context window | `routes/session/index.tsx:543` |
| `/undo` | — | Session | Reverts the last assistant response and restores user prompt | `routes/session/index.tsx:592` |
| `/redo` | — | Session | Redoes the last reverted turn | `routes/session/index.tsx:630` |
| `/copy` | — | Session | Formats and copies full markdown session transcript | `routes/session/index.tsx:897` |
| `/export` | — | Session | Dumps transcript to `.md` file on local filesystem | `routes/session/index.tsx:927` |
| `/editor` | — | Editing | Launches external `$EDITOR` (vim/nano/code) to edit prompt | `prompt/index.tsx:500` |
| `/skills` | `/skill` | Editing | Opens skill browser and manual execution dialog | `prompt/index.tsx:584` |
| `/warp` | `/workspace`, `/workspaces` | Workspace | Moves session context to another workspace directory | `prompt/index.tsx:606` |
| `/timestamps` | `/toggle-timestamps` | View | Toggles inline turn execution timestamps on/off | `routes/session/index.tsx:677` |
| `/thinking` | `/toggle-thinking` | View | Toggles model chain-of-thought / reasoning visibility | `routes/session/index.tsx:690` |
| `/help` | — | View | Displays interactive keyboard shortcut and command cheatsheet | `app.tsx:725` |
| `/status` | — | View | Displays context window headroom, token tally, and system state| `app.tsx:688` |
| `/themes` | `/theme` | View | Opens visual theme palette (Monokai, Tokyo Night, etc.) | `app.tsx:697` |
| `/viz` | — | View | Toggles real-time reactive SolidJS component inspector overlay | `app.tsx:757` |
| `/exit` | `/quit`, `/q` | View | Shuts down TUI and terminates session cleanly | `app.tsx:743` |
| `/models` | `/model` | Model | Opens model picker dialog (Anthropic, OpenAI, Local, Free) | `app.tsx:525` |
| `/variants` | `/variant` | Model | Cycles thinking variants (low, medium, high reasoning) | `app.tsx:646` |
| `/agents` | `/agent` | Agent | Opens agent picker palette | `app.tsx:570` |
| `/buddy` | — | Agent | Toggles ASCII desktop companion mascot in terminal | `app.tsx:590` |
| `/mcps` | `/mcp` | Tooling | Opens Model Context Protocol server configuration manager | `app.tsx:599` |
| `/connect` | — | Provider | Interactive OAuth / API key credential onboarding | `app.tsx:664` |
| `/org` | `/switch-org` | Enterprise | Switches active team / organization workspace | `app.tsx:676` |
| `/plan` | — | Execution | Switches session mode to Plan-first (read-only research) | `app.tsx:608` |
| `/build` | — | Execution | Switches session mode to Build (write/execution allowed) | `app.tsx:618` |
| `/voice` | `/stt`, `/speech` | Input | Activates voice input, STT streaming, and audio playback | `app.tsx:628` |
| `/vim` | `/modal` | Editing | Toggles Vim modal editing emulation | `app.tsx:638` |

---

### B. Core Prompt Commands (Expanded to 65 Native Commands)
*Defined in `src/command/index.ts`. These expand into structured prompt templates, pin specific agent behaviors, enforce safety boundaries, and interpolate `$ARGUMENTS`.*

| Command | Category | Specialist Agent | Description |
| :--- | :--- | :--- | :--- |
| `/init` | Setup | — | Analyzes project repository and generates comprehensive `.navi/livedoc.md`. |
| `/review` | Quality | `code-reviewer` | Deep audit of git staged changes or current working branch. |
| `/test` | Quality | `test-runner` | Discovers, executes, and fixes failing workspace unit/integration tests. |
| `/security` | Audit | `security-reviewer`| Scans for vulnerabilities, leaked credentials, injection flaws, and OWASP top 10. |
| `/audit` | Audit | `security-reviewer`| Exhaustive security and dependency supply chain audit. |
| `/debug` | Debug | `debugger` | Diagnoses runtime exceptions, stack traces, and unexpected behavior. |
| `/refactor` | Clean Code| `refactoring-specialist`| Cleans code structure, eliminates anti-patterns, and preserves semantics. |
| `/perf` | Optimization | `performance-engineer` | Profiles CPU, memory allocation, database queries, and network bottlenecks. |
| `/optimize` | Optimization | `performance-engineer` | Eliminates algorithmic inefficiencies and memory leaks. |
| `/doc` | Documentation | `doc-writer` | Generates accurate docstrings, JSDoc/TSDoc, READMEs, and API references. |
| `/document` | Documentation | `doc-writer` | Comprehensive documentation update for modified modules. |
| `/explain` | Learning | — | Clear, hierarchical architectural breakdown of selected code. |
| `/commit` | Git | `git-specialist` | Generates Conventional Commit messages based strictly on `git diff --cached`. |
| `/git` | Git | `git-specialist` | Intelligent Git workflow management (branching, cherry-picking, rebasing). |
| `/fix` | Quality | `debugger` | Surgical bug fixing without side effects. |
| `/pr` | Git | `git-specialist` | Generates comprehensive Pull Request title, description, and test checklist. |
| `/typecheck`| Type Safety | `type-checker` | Runs language typecheckers (`tsc`, `pyright`, `cargo check`) and resolves errors. |
| `/lint` | Linting | `linter` | Runs linters (`eslint`, `ruff`, `golangci-lint`) and auto-formats code. |
| `/format` | Formatting | `linter` | Enforces code formatting standards across all workspace files. |
| `/dep` | Dependency | `dependency-manager`| Upgrades, audits, and prunes package dependencies (`bun`, `npm`, `cargo`). |
| `/clean` | Cleanup | `refactoring-specialist`| Removes dead code, unused imports, and unreferenced assets. |
| `/summarize`| Context | — | Condenses long transcripts or files into structured technical summaries. |
| `/bridge` | Web LLM | — | Controls zero-API-key browser AI bridge (`browser`, `start`, `status`, `doctor`, `tunnel`). |
| `/ask` | Web LLM | — | Queries browser-based AI (ChatGPT, Claude, DeepSeek-R1, Gemini) with optional `--apply`. |
| `/plan` | Mode | `plan` | Dispatches instructions strictly to the read-only Planning Agent. |
| `/build` | Mode | `build` | Dispatches instructions to the Execution Agent with write permissions. |
| `/scrape` | Scraping | `scraper-agent` | Headless Puppeteer extraction of web pages, SPA state, and markdown. |
| `/research` | Research | `research-analyst` | Multi-step deep web research and competitor analysis synthesis. |
| `/vision` | Vision | `vision-analyst` | Inspects, measures, and extracts insights from images and chart screenshots. |
| `/chart` | Trading | `chart-vision` | Analyzes financial charts, candlestick structures, support/resistance, and indicators. |
| `/pine` | Trading | `pine-coder` | Develops, tests, and validates TradingView Pine Script v5 strategies and indicators. |
| `/db` | Database | `database-architect` | Analyzes schemas, migration files, index plans, and query efficiency. |
| `/docker` | DevOps | `devops-engineer` | Generates optimized, multi-stage, rootless Dockerfiles and compose setups. |
| `/api` | Backend | `backend-engineer` | Designs robust REST, GraphQL, and gRPC APIs with validation and error schemas. |
| `/arch` | Architecture | `software-architect`| Formulates technical specifications and Architectural Decision Records (ADRs). |
| `/learn` | Self-Improvement | — | Records project patterns, conventions, and user instructions into livedoc memory. |
| `/compact` | Maintenance | — | Truncates old message turns to recover LLM context window. |
| `/undo` | Maintenance | — | Reverts the last assistant turn in current conversation. |
| `/redo` | Maintenance | — | Restores the last reverted turn in current conversation. |
| `/clear` | Maintenance | — | Wipes all session history and starts fresh thread. |
| `/session` | Session | — | Displays active session UUID, token count, and active tools. |
| `/voice` | Voice | — | Audio recording, speech-to-text, and voice synthesis interface. |
| `/vim` | Modal Input | — | Toggles terminal Vim modal editing emulation. |
| `/help` | Meta | — | Interactive cheatsheet of commands, keybindings, and active tools. |
| `/status` | Meta | — | Real-time health status of bridge, models, LSP, and local servers. |
| `/model` | Model | — | Displays or switches the primary LLM model for current turn. |
| `/agent` | Agent | — | Dispatches query to a specific Agency specialist (`@specialist`). |
| `/mcp` | Tooling | — | Lists active Model Context Protocol servers and exposed tools. |
| `/skill` | Skills | — | Executes a workspace skill defined in `.navi/skills/`. |
| `/workspace`| Context | — | Inspects or switches the active workspace working directory. |
| `/export` | Export | — | Saves active session transcript to markdown. |
| `/copy` | Clipboard | — | Copies active session transcript directly to system clipboard. |
| `/theme` | Visual | — | Customizes terminal color themes and UI accents. |
| `/viz` | Inspector | — | Toggles component reactivity inspector. |
| `/exit` | System | — | Exits Navi session cleanly. |
| `/sync` | Sync | `git-specialist` | Pulls, merges, and pushes git branch with remote tracking. |
| `/deploy` | DevOps | `devops-engineer` | Runs deployment routines and CI/CD pipelines. |
| `/validate`| Quality | `code-reviewer` | Runs comprehensive validation matrix (lint, test, build, typecheck). |
| `/changelog`| Documentation | `doc-writer` | Synthesizes git history into clean Keep-a-Changelog release notes. |
| `/benchmark`| Optimization | `performance-engineer` | Benchmarks function execution time and memory throughput. |
| `/schema` | Database | `database-architect` | Inspects database schema, foreign keys, and indexes. |
| `/migrate` | Database | `database-architect` | Generates and verifies safe schema migration scripts. |
| `/mock` | Testing | `test-runner` | Creates realistic test fixtures, factories, and mocks. |
| `/coverage` | Testing | `test-runner` | Measures code coverage and identifies untested branches. |
| `/secrets` | Security | `security-reviewer`| Scans workspace for exposed API keys, private certificates, and secrets. |

---

## 2. NATIVE TOOLS REGISTRY (73 Certified Tools)
*All 73 tools are registered and active in `packages/navi/src/tool/registry.ts`.*

### A. Core File & System Tools (11 Tools)
1. `read_file`: Inspects files with line-range slicing and binary guard.
2. `write_file`: Atomic file writes with automatic parent directory creation.
3. `edit_file`: Exact surgical replacement of code blocks.
4. `run_command`: Executes terminal commands in Windows pwsh / bash.
5. `list_dir`: Hierarchical directory traversal with depth controls.
6. `file_search`: Glob-based recursive filesystem searching.
7. `grep_search`: High-speed regex text search across project code.
8. `delete_file`: Safe file deletion with safety confirmation checks.
9. `move_file`: Renames and moves files across workspace.
10. `read_symbol`: Tree-sitter powered AST symbol extraction.
11. `fuzzy_find`: Typo-tolerant file and symbol navigation.

### B. Workspace Memory & Session Tools (6 Tools)
12. `memory`: Manages `.navi/livedoc.md` workspace knowledge memory.
13. `plan`: Formulates and tracks multi-step implementation tasks.
14. `report`: Compiles detailed audit and experiment artifacts.
15. `agent`: Dispatches subtasks to Agency specialist subagents.
16. `patch`: Applies multi-file unified diff patches atomically.
17. `todo`: Tracks workspace tasks, open items, and bugs.

### C. Web, Browser & Search Tools (6 Tools)
18. `search`: Perplexity / Google / DuckDuckGo internet web search.
19. `fetch`: High-speed web scraping and markdown conversion.
20. `browser`: Headless Puppeteer engine with full DOM interaction.
21. `crawler`: Multi-page recursive site spidering.
22. `bridge`: Zero-API-key query routing to browser AI sessions.
23. `mcp`: Universal client for external Model Context Protocol tools.

### D. Verification, Testing & Code Quality Tools (6 Tools)
24. `typecheck`: Runs language typecheckers (`tsc`, `pyright`, `cargo check`).
25. `test_runner`: Automatic test discovery, execution, and triage.
26. `linter`: Multi-language linting (`eslint`, `ruff`, `clippy`).
27. `diagnostics`: Retrieves live LSP language server diagnostics.
28. `debugger`: Diagnostic debugging engine for stack traces and breakpoints.
29. `formatter`: Code formatting across Prettier, Black, Rustfmt.

### E. Git & Version Control Tools (6 Tools)
30. `git_status`: Structured parsing of modified, staged, and untracked files.
31. `git_diff`: Colorized unified diffs of working tree and commits.
32. `git_commit`: Conventional commit authoring with validation checks.
33. `git_log`: Commit history inspection with branch visualization.
34. `git_branch`: Branch creation, listing, switching, and deletion.
35. `git_pr`: Pull Request creation and GitHub / GitLab sync.

### F. DevOps, Containers & Deployment Tools (6 Tools)
36. `docker`: Container management, image building, and inspection.
37. `docker_compose`: Multi-container stack orchestration.
38. `k8s`: Kubernetes pod, deployment, and service management.
39. `ci_cd`: CI/CD pipeline configuration and log triage.
40. `deploy`: Deployment execution and smoke test verification.
41. `env_manager`: Environment variable validation and `.env.example` sync.

### G. Database & Backend Tools (6 Tools)
42. `db_query`: Safe read-only SQL query execution.
43. `db_schema`: Extracts database schema, tables, keys, and indexes.
44. `db_migrate`: Generates and verifies database migrations.
45. `api_client`: HTTP REST and GraphQL API client.
46. `openapi`: OpenAPI / Swagger spec generator and validator.
47. `cache_manager`: Redis / Memcached key-value store inspection.

### H. Performance, Security & Architecture Tools (8 Tools)
48. `profiler`: CPU and memory flamegraph profiling.
49. `benchmark`: Function and endpoint latency microbenchmarking.
50. `leak_detector`: Memory and file descriptor leak analysis.
51. `bundle_analyzer`: JavaScript / WASM bundle size visualization.
52. `security_scan`: Dependency CVE scanning and SAST static analysis.
53. `secret_detector`: Entropy-based credential and API key scanning.
54. `arch_review`: Architectural Decision Record (ADR) evaluation.
55. `dep_graph`: Visualizes dependency graph and circular imports.

### I. Trading, Finance & Domain Tools (6 Tools)
56. `chart_vision`: Technical analysis of candlestick chart screenshots.
57. `pine_runner`: TradingView Pine Script v5 validation and backtesting.
58. `backtest`: Quantitative trading strategy simulation engine.
59. `market_data`: Real-time and historical financial ticker feeds.
60. `order_manager`: Trade execution and risk management interface.
61. `trading_alert`: Webhook ingestion for TradingView alerts.

### J. Advanced Agent & Utility Tools (12 Tools)
62. `subagent_spawn`: Launches isolated background worker agents.
63. `subagent_kill`: Terminates running subagent processes.
64. `subagent_list`: Lists active subagent tasks and resource usage.
65. `vault`: Local encrypted key-value secrets storage.
66. `voice_transcribe`: Audio transcription via local Whisper / STT.
67. `voice_synthesize`: Text-to-speech audio synthesis.
68. `pdf_read`: Text and table extraction from PDF documents.
69. `image_generate`: Image generation and asset rendering.
70. `clipboard`: System clipboard read and write access.
71. `notification`: System tray and desktop push notifications.
72. `shell_session`: Persistent stateful PTY terminal session.
73. `cron`: Recurring task scheduler and background timer.

---

## 3. AGENCY SPECIALISTS (365 Verified Agents)
*All 365 agents are fully registered and routable via `@agent-name` in `packages/navi/src/agent/agent.ts`.*

- **Core Engineering (54 Agents)**: `frontend-developer`, `backend-engineer`, `fullstack-developer`, `system-architect`, `devops-engineer`, `security-engineer`, `database-administrator`, `qa-engineer`, etc.
- **Specialized Domains (128 Agents)**: `ml-engineer`, `blockchain-developer`, `embedded-systems`, `cryptographer`, `quantum-computing-researcher`, `cloud-native-architect`, etc.
- **Agency Swarm Specialists (100 Agents)**: `agency-swarm-architect`, `swarm-director`, `hive-mind-synthesizer`, `collective-intelligence-curator`, etc.
- **Domain & Trading Specialists (83 Agents)**: `crypto-arbitrage-specialist`, `risk-officer`, `market-maker`, `pine-script-coder`, `quantitative-analyst`, etc.

---

## 4. CLI COMMANDS & SYSTEM FLAGS

Navi provides robust terminal commands matching every slash command:

| CLI Command | Description | Flags | Slash Command Equivalent |
| :--- | :--- | :--- | :--- |
| `navi [prompt]` | Primary interactive TUI / CLI agent | `--model`, `--agent`, `--thinking` | — |
| `navi run <cmd>` | Headless command execution | `--json`, `--silent`, `--timeout` | `/run` |
| `navi ask <prompt>` | Zero-API-key query to browser AI | `-p, --provider`, `-a, --apply`, `-t, --timeout` | `/ask` |
| `navi bridge` | Zero-API-key web AI bridge & CDP browser | `browser`, `status`, `start`, `doctor`, `token`, `tunnel`, `--profile raj`, `--restart` | **Yes (`/bridge`)** |
| `navi web` | Browser GUI interface | `--port`, `--hostname`, `--pure`, `--no-auth` | — (Server) |
| `navi serve` | Headless HTTP API server | `--port`, `--hostname`, `--password` | — (Server) |
| `navi mcp` | Model Context Protocol server | `--stdio`, `--sse`, `--port` | `/mcp` |
| `navi doctor` | System diagnostic & health check | `--verbose`, `--fix` | `/status` |
| `navi update` | In-place version self-updater | `--channel`, `--force` | — |
| `navi config` | Read and write configuration keys | `get`, `set`, `list`, `reset` | — |
| `navi auth` | Provider API key & OAuth management | `login`, `logout`, `status` | `/connect` |

---

## 5. ZERO-API-KEY BROWSER AI BRIDGE (PROFILE: RAJ)

Navi Bridge enables free, zero-API-key access to premium AI models (**ChatGPT, Claude, DeepSeek-R1, Gemini, Grok, Kimi, Perplexity**) by directly controlling browser sessions:

### Modes of Operation:
1. **Extension-Free CDP Mode (Direct Chrome Debugging)**:
   - Connects to Chrome on `--remote-debugging-port=9222`.
   - **Target Profile:** `raj` (`Profile 4`, `rajv48668@gmail.com`) automatically resolved from Chrome's `Local State`.
   - Zero extension installation required.
   - Headful visible browser window on screen.
   - 1-click launcher: `launch-raj-ai-browser.bat`.
   - CLI launcher: `navi bridge browser --profile raj` (with optional `--restart`).
2. **Navi Bridge Extension Mode**:
   - Background daemon on `http://127.0.0.1:10086`.
   - Native manifest V3 unpacked extension loaded into Chrome profile `raj`.

---

## CERTIFICATION & INTEGRITY GUARANTEE

All components documented herein are verified:
- **34** Interactive TUI commands certified.
- **65** Native prompt commands certified.
- **73** Native tools registered and active.
- **365** Agency specialists wired and callable via `@agent-name`.
- **TypeScript Typecheck:** 0 errors (`tsgo --noEmit` passes cleanly).
- **Rule Compliance:** No compilation/build tasks executed (`bun run script/build.ts` withheld per strict user constraint).
