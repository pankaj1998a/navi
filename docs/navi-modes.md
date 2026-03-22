# Navi Modes Documentation

This document summarizes the different execution, thinking, and permission modes available in Navi.

## 1. Agent Execution Modes
These modes define how tasks are orchestrated and run by the underlying engine.

| Mode | Description | Best Use Case |
| :--- | :--- | :--- |
| **Sequential** | Tasks are executed one after another in order. | Dependent steps (e.g., Plan -> Edit -> Test). |
| **Parallel** | Multiple tasks are executed simultaneously. | High-throughput research or scanning large codebases. |
| **Swarm** | Multiple agents collaborate to reach a consensus on a single task. | Critical code reviews or complex bug hunting. |
| **Programmatic** | Follows specialized TypeScript generator logic for optimized paths. | Structured research (Researcher) or architectural planning. |

## 2. Primary Agent Roles (Slash Commands/Switcher)
Specialized "personalities" that Navi can adopt during a session.

*   **Build**: Default development mode with full write access. Used for general implementation, refactoring, and running commands.
*   **Specs**: The "Ultimate Suite" for Strategy, Planning, Architecture, and Precision Engineering. Handles everything from high-level vision and marketing strategy to precise, verified code implementations via structured workflows.
*   **Ask**: Explorer mode. Designed for deep codebase understanding and explanation without making changes.

---

## 🚀 Global Parallel Research
Navi now integrates **Advanced Parallel Research** directly into *every* mode. 

*   **Default Behavior**: Any command requiring web research automatically spawns at least **3 parallel sub-agents**.
*   **Scalability**: For complex queries, Navi can scale up to **10 parallel surfers** to ensure comprehensive coverage and cross-referenced summaries.
*   **Date-Aware**: All research automatically includes current temporal context to ensure documentation and library versions are up-to-date.

---

## ⚡ Elastic Swarm (Universal Scaling)
Navi dynamic orchestration (Elastic Swarm) allows any mode to spawn multiple instances of specific sub-agents based on the task:

*   **Implementation Scaling**: Spawns up to **5 parallel sub-agents** for coding, frontend, or backend tasks (e.g., "parallelly refactor 5 components").
*   **Research Scaling**: Spawns up to **10 parallel surfers** for deep dives.
*   **Automatic Detection**: Navi detects keywords like "multiple", "parallel", or "all files" to automatically scale the swarm.
*   **Manual Control**: You can explicitly request capacity (e.g., "use 5 coding agents for this fix").

## 3. Thinking Modes (Reasoning Depth)
Controls how much internal "thought" and tokens are spent before providing an answer.

*   **Off**: Immediate response. Fastest and cheapest.
*   **Think**: Standard balanced reasoning (Standard for Claude/Gemini).
*   **Max**: Deepest reasoning. Use for complex logic fixes or structural refactors.
*   **Adaptive**: Navi analyzes the prompt complexity and chooses the best level automatically.

## 4. Permission Modes (Safety)
Defines Navi's level of autonomy over your filesystem.

*   **Safe**: Read-only. No file modifications allowed.
*   **Ask**: Proposes changes but requires manual "Yes" for every edit.
*   **Allow-All**: Full autonomy. Edits files and runs commands automatically.

## 5. Web Search Context Mode
*   **Date-Aware Search**: Automatically appends current context (e.g., "as of February 2026") to queries to avoid outdated dependencies or information.

---


