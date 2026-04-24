# PROJECT: Navi

## Overview
Navi is a powerful AI coding assistant that runs directly in your terminal. It features a beautiful TUI (Terminal User Interface) and supports multiple AI providers including Claude, GPT, Gemini, and more. Navi is built for performance and scale, providing a complete development cycle directly from your command line.

## Vision
To become a complete AI-augmented project manager and coding assistant that provides repeatable, version-controlled development cycles (plan → execute → verify) without overloading the LLM context.

## Tech Stack
- **Core**: Node.js / Bun
- **Language**: TypeScript / Rust (for performance-critical parts)
- **TUI**: Custom React-based TUI for terminal
- **Package Manager**: Bun
- **AI Integration**: Multi-provider support (Anthropic, OpenAI, Google, OpenRouter, etc.)
- **Protocol**: Model Context Protocol (MCP) support

## Core Goals
1. **Parallel Agent Execution**: Run multiple AI agents simultaneously to solve complex tasks.
2. **Beautiful TUI**: Provide a modern, responsive terminal interface.
3. **Spec-Driven Development**: Integrate GSD-style spec layers (PROJECT.md, ROADMAP.md, STATE.md, REQUIREMENTS.md).
4. **Atomic Operations**: Implement atomic planning and execution with conventional git commits.
5. **Agent Awareness**: Dynamically select optimal models for sub-tasks.
