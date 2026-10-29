---
name: graphify
description: "Use for any question about a codebase, its architecture, file relationships, blast radius impact, or dependency cycles. Turns any workspace into a persistent knowledge graph with God nodes, community detection, shortest path, and blast radius affected tools."
---

# Code Knowledge Graph & Architecture Intelligence (`navi graph`)

Turn any repository or project into a navigable, queryable knowledge graph backed by **Rust Native FFI acceleration**.
Provides blast radius impact analysis (`affected`), God node extraction, dependency cycle detection, shortest architectural path, and agent query context.

## Core Commands

```bash
# 1. Build knowledge graph for current workspace (generates graph.json & GRAPH_REPORT.md)
navi graph build

# 2. Query architectural context with BFS traversal (fits agent token budget)
navi graph query "<question>"
# Example:
navi graph query "How is authentication and JWT validation implemented?"

# 3. Blast Radius Impact Analysis (what depends on this file or symbol)
navi graph affected <symbol-or-file> --depth <N>
# Example:
navi graph affected src/auth.ts --depth 2

# 4. Shortest Architectural Path between two components
navi graph path <from-node> <to-node>
# Example:
navi graph path src/main.ts src/db.ts

# 5. Core Architectural Hubs (God Nodes)
navi graph god-nodes

# 6. Circular Dependency Cycles
navi graph cycles

# 7. Print Full Architectural Report
navi graph report

# 8. Generate Multi-Page Architecture Knowledge Wiki
navi graph wiki [output-dir]
```

## Agent Best Practices

- **Orient before reading**: Before reading dozens of raw files or running unbounded grep searches across unfamiliar codebases, check `graphify-out/graph.json` or run `navi graph query "<question>"`.
- **Blast radius before refactoring**: When refactoring a central type, class, or module, run `navi graph affected <target> --depth 2` to discover all affected callers, importers, and dependents.
- **Architectural smells**: Run `navi graph cycles` to identify tight circular coupling that should be decoupled.
