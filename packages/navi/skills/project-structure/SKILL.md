---
name: project-structure
description: "Map and analyze TypeScript/JavaScript repository structure: exported symbols, subsystem boundaries, clean modularity, and duplication detection."
---

# Project Structure & Architecture Mapping

Analyze codebase architecture and symbol organization across modules to guide refactoring, maintain clean boundaries, and eliminate duplicate logic.

## Principles

1. **Clear Module Boundaries**:
   - Each package or directory should have a single entry point (e.g. `index.ts`) defining its public contract.
   - Internal implementation files should not be imported directly across foreign module boundaries.

2. **Single Responsibility**:
   - Avoid dumping unrelated utilities into generic `utils/` or `helpers/` files. Group functions by domain or lifecycle.

3. **Dependency Direction**:
   - Primitives and schemas should have zero dependencies on higher-level orchestrators or UI components.
   - Core domain logic should remain independent of transport layers (HTTP, CLI, WebSocket).

4. **Surgical Refactoring**:
   - Trace symbol usage with `grep` before moving or renaming exports.
   - Ensure backwards compatibility or update all import call sites in a single atomic pass.
