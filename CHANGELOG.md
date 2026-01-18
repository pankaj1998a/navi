# Changelog

All notable changes to Navi will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- **Master Agent Orchestrator** - Intelligent task routing and model management
- **Parallel Agent Execution** - Run up to 10 agents concurrently
- **Autonomous Loop** - Ralph-inspired PRD-driven development
- **PRD Manager** - Structured task tracking with priority-based execution
- **Fast I/O Tools** - Batch file operations (20 reads, 10 writes per call)
- **Shared Agent Memory** - Cross-agent coordination with TTL support
- **Agent Supervisor** - Lifecycle management (stop, start, restart)
- **Progress Tracking** - `progress.txt` for learnings between iterations
- **Privacy Documentation** - Clear data policy in PRIVACY.md

### Changed
- Renamed all `OPENCODE_` environment variables to `NAVI_`
- Renamed SDK functions from `createOpencode*` to `createNavi*`
- Improved TUI performance (30 FPS, message virtualization)

### Removed
- Removed `temp-gemini-cli/` directory (~1,644 files)
- Removed `temp-antigravity-auth/` directory (~96 files)
- Removed unnecessary log and devlog files
- Removed `STATS.md` and `README.zh-TW.md`

### Security
- Telemetry disabled by default (opt-in only)
- No data sent to external servers by default
- Verified no opencode server URLs in codebase

## [0.1.0] - 2026-01-18

### Added
- Initial release of Navi
- Forked from OpenCode with full rebranding
- Multi-provider support (Gemini, Anthropic, OpenAI, etc.)
- TUI interface with Ink
- Browser automation support
- MCP server integration
