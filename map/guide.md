# Navi Project Map & Guide

Welcome, AI Agent! This guide is designed to help you quickly understand the structure of the Navi project so you can identify issues, fix bugs, and implement new features while using fewer tokens to explore the codebase.

## 🧭 Project Architecture overview

Navi is a powerful multi-platform AI coding assistant system. It is built as a **TypeScript / Bun** monolithic repository (monorepo). 

The application has multiple interfaces: a Terminal User Interface (TUI), a Desktop application, and Web/Console platforms. Most of the core backend intelligence is located in `packages/navi/`.

---

## 🏗️ Workspace Map (`packages/*`)

All major components of the system are split into separate workspaces inside the `packages/` directory.

### 🧠 Core Engine & Backend (`packages/navi/`)
This is the **primary package**. It contains the fundamental application logic, AI agents, CLI interface, API connections, and tool extensions.
- **`packages/navi/agents/`**: Core AI agent implementations, routines, and autonomous loops (e.g., Codebase Investigator, PRD Manager).
- **`packages/navi/commands/`**: Handlers for all CLI commands (e.g., `init`, `restore`, `memory`).
- **`packages/navi/tools/`**: Tool hook integrations allowing the AI to interact with the file system, read/write files, and run shell commands.
- **`packages/navi/services/`**: Internal core services (state management, API orchestrators, background processes).
- **`packages/navi/mcp/`**: Model Context Protocol integration and standard tool handling.
- **`packages/navi/code_assist/`**: Advanced logic for context gathering and code assistance mechanisms.

### 🖥️ Desktop App (`packages/desktop/`)
The native desktop application wrapper for Navi.
- Built using **Tauri** (Rust + web tech).
- **`packages/desktop/src-tauri/src/`**: Rust backend code (`main.rs`, `lib.rs`, `cli.rs`) managing OS-level interactions, windowing, and the native capabilities needed for the desktop GUI.

### 🎨 Frontend & UI Library (`packages/app/` & `packages/ui/`)
These packages contain the frontend views and reactive components used by the GUI versions of Navi.
- **`packages/app/`**: Contains the main routing, application context, and view pages (`src/pages/`, `src/context/`). It serves as the main web interface.
- **`packages/ui/`**: A shared UI component library. Contains all common atomic components like buttons, dialogs, icons, and styling components (`button.tsx`, `markdown.tsx`, etc.).

### 🌐 Cloud & Web Surfaces
- **`packages/web/`**: The public facing website or landing page, likely built with Astro (`astro.config.mjs`, `pages/`, `components/`).
- **`packages/console/`**: A fully-fledged serverless web application (admin/user console) comprising its own `app/`, `core/`, and `function/` sub-directories.

### 🏢 Enterprise & External Integrations
- **`packages/enterprise/`**: Code for enterprise-grade features, enhanced security policies, and team licensing limits.
- **`packages/extensions/`**: Browser or editor extensions.
- **`packages/slack/`**: Interoperability code to allow running or querying Navi agents directly from a Slack UI integration.

### 🛠️ Utilities & SDKs
- **`packages/sdk/`**: SDK implementations allowing third-party services to integrate programmatically with Navi's backend or open APIs.
- **`packages/util/`**: Reusable shared helpers across the monorepo packages.
- **`packages/function/`**: Contains serverless infrastructure logic, such as AWS Lambda SST functions (`sst-env.d.ts`).
- **`packages/script/`**: Developer and deployment automation scripts used globally across the workspace.

---

## 📁 Root Level Directories

- **`test/`**: Centralized test folder for project-wide integration test cases, scripts (`test_ai_session.ts`, `test-navi-url.ts`), and legacy experiments that were relocated from the root directory.
- **`map/`**: Home to this `guide.md` to offer a fast architectural blueprint to AI systems.
- **`docs/`**: Comprehensive project-level documentation, including API usage and development guidelines.
- **`infra/`** / **`nix/`**: Contains declarative definitions of system dependencies and infrastructure provisioning files (e.g., `flake.nix` for Nix-based development environments).

---

## 💡 Best Practices for AI Agents

1. **Be Precise**: Use the workspace map to navigate directly to what needs changing.
   - Example: Need to modify an agent's reasoning loop? Jump directly to `packages/navi/agents/`.
   - Example: Need to adjust how a button is styled in the UI? Jump directly to `packages/ui/src/components/`.
2. **Consult tests**: Verify changes by running the related tests. Each package generally maintains a co-located test setup or relies on specific workspaces (check `package.json` testing scripts).
3. **Execution & Builds**: Since this is a Bun workspace, many standard commands rely on `bun run`. Verify the relevant script inside the specific package `package.json` to build or run logic.
4. **Agent behavior & rules**: To modify the baseline operation instructions of the agents, edit the prompts locally in `packages/navi/prompts/` or the high-level instructions (like `AGENTS.md`).

When exploring this codebase, always leverage this guide. Use targeted searches inside specific packages rather than full deep scans to preserve tokens and focus reasoning.
