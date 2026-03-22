# Task: Refine Navi Modes Behavior

## Status
- [x] **In Progress**: Executing role consolidation and global parallel research integration.

## Task Description
The goal is to modify and refine the behavior of Navi's different modes based on user feedback. This includes Agent Execution Modes, Primary Roles, Thinking Levels, and Permission Modes.

## Current Progress
- Documentation of current modes created at `docs/navi-modes.md`.
- Mode-aware Google AI Search added with auto-summarization and current-date context.
- Parallel research (3x sub-agents) implemented for Researcher/Surfer roles.

- [X] **Consolidate Planning Roles**: Merged `plan`, `specs`, and `architect` into a unified `specs` mode.
- [X] **Global Parallel Research**: Integrated scalable parallel research (3-10 surfers) into any mode requiring search. 
- [X] **Ultimate Specs Merging**: Integrated `marketing` (Strategy) and `editor` (Precision Editing) into the **`specs`** mode.
- [X] **Implicit Routing & Method Cleanup**: Removed `router` and `ralph` as primary roles to simplify the TUI.

## Final Architecture
Navi now operates with a clean, 3-Suite architecture:
1. **Build**: Active Development & Implementation.
2. **Specs**: High-level Strategy, Architecture, and Precision Editing.
3. **Ask**: Read-only Knowledge & Exploration.

*Parallel research is now a background capability of all modes.*

- [X] **Universal Sub-Agent Scaling**: Enabled all primary modes to spawn multiple instances of sub-agents (cap: 5 for implementation, 10 for research).
- [X] **Elastic Swarm Documentation**: Added to `docs/navi-modes.md`.

## Status
- [X] **Completed**: 2026-02-07
- [X] **Architecture Simplified**: Build, Specs, Ask.
