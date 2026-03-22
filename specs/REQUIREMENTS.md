# REQUIREMENTS: Navi

## Functional Requirements
1. **Multi-Provider Support**: Must support Anthropic, OpenAI, Google Gemini, GitHub Copilot, and OpenRouter.
2. **TUI Interface**: Must provide an interactive TUI with keyboard shortcuts and theme support.
3. **Agent Orchestration**: Must be able to spawn and manage multiple agents in parallel.
4. **Tool Access**: Agents must have access to file system, shell, web fetch, and codebase search.
5. **MCP Integration**: Must support Model Context Protocol for extending tools.
6. **Spec Layer Integration**: Must read and update `PROJECT.md`, `ROADMAP.md`, `STATE.md`, and `REQUIREMENTS.md`.
7. **Planning & Execution**: Must support generating atomic plans and executing them with verification.
8. **Git Integration**: Must generate conventional commit messages based on task completion.

## Non-Functional Requirements
1. **Performance**: TUI must be responsive; heavy tasks should be offloaded to Rust or optimized.
2. **Security**: Must have a granular permission system for destructive actions.
3. **Portability**: Must run on Windows, macOS, and Linux.
4. **Maintainability**: Codebase should be modular and well-documented.
5. **Context Efficiency**: Must keep LLM context small by using spec files and selective file reading.
