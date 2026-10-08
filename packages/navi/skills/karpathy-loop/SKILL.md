---
name: karpathy-loop
description: Autonomous iterative experimentation and coding loop based on Andrej Karpathy's autoresearch methodology. Use when optimizing code, running test-bench loops, improving performance metrics, or conducting automated trial-and-error improvements with git-backed commit/rollback discipline.
---

# The Karpathy Coding Loop

The **Karpathy Coding Loop** (inspired by Andrej Karpathy's `autoresearch` and iterative agentic development) is a protocol for automated, empirical code optimization and problem solving.

Instead of writing code speculative of performance or correctness, an agent runs a closed loop:
**Hypothesize $\to$ Edit $\to$ Measure $\to$ Commit or Revert $\to$ Repeat.**

```
          ┌───────────────────────────────────┐
          │   1. Read Codebase & Baseline     │
          └─────────────────┬─────────────────┘
                            │
              ┌─────────────▼─────────────┐
        ┌────►│  2. Propose 1 Hypothesis  │
        │     └─────────────┬─────────────┘
        │                   │
        │     ┌─────────────▼─────────────┐
        │     │   3. Surgical Code Edit   │
        │     └─────────────┬─────────────┘
        │                   │
        │     ┌─────────────▼─────────────┐
        │     │  4. Run Evaluation Metric │
        │     └─────────────┬─────────────┘
        │                   │
        │     ┌─────────────▼─────────────┐
        │    /     Did Metric Improve?     \
        │   <                               >
        │    \                             /
        │     └───────┬─────────────┬─────┘
        │         Yes │             │ No
        │             ▼             ▼
        │     ┌──────────────┐ ┌──────────────┐
        │     │  git commit  │ │  git reset   │
        │     └───────┬──────┘ └──────┬───────┘
        └─────────────┴───────────────┘
```

---

## Core Rules of the Loop

### 1. The Immutable Evaluation Seam
- The test suite, benchmark runner, or evaluation script is the **ground truth**.
- **Never allow edits to the evaluation harness** while running the optimization loop. Otherwise, the agent will learn to lower the bar or delete tests to "improve" the score.

### 2. Strict Reversion on Failure
- If an edit causes a compiler error, test failure, runtime crash, or regressed metric:
  ```bash
  git reset --hard HEAD
  git clean -fd
  ```
- **Zero dead code or partial failures** are left behind. Every iteration starts from a guaranteed working state.

### 3. One Variable at a Time
- Do not refactor multiple unrelated files in one step.
- An iteration tests exactly one isolated hypothesis. If it succeeds, it forms an atomic commit.

### 4. Bounded Compute / Time Budget
- Each evaluation run should take a fixed, reasonable duration (e.g. 10 seconds to 5 minutes).
- If an experiment hangs, kill it immediately, revert, and note the timeout.

---

## When to Use

- **Performance Optimization**: Reducing latency, memory allocations, bundle size, or SQL query count.
- **Flaky / Failing Test Remediation**: Systematically testing fixes against an existing test suite.
- **Refactoring & Simplification**: Reducing cyclomatic complexity while continuously verifying tests pass.
- **Algorithm Exploration**: Trying alternate data structures (e.g. Trie vs Hash Map, iterative vs recursive) backed by empirical benchmarks.

---

## Experiment Run Log Example

Always maintain a clear tabular log during execution:

| Iteration | Hypothesis | Target File | Metric | Delta | Result |
|---|---|---|---|---|---|
| Baseline | `bun test` baseline | - | 1.82s | - | Reference |
| 1 | Memoize AST tokenization | `src/parser.ts` | 1.24s | -0.58s (-31%) | **KEPT (Commit `a1b2c3d`)** |
| 2 | Parallelize file globbing | `src/loader.ts` | 1.45s | +0.21s (+17%) | **REVERTED (Regression)** |
| 3 | Use TypedArray buffer | `src/buffer.ts` | 0.98s | -0.26s (-21%) | **KEPT (Commit `e4f5g6h`)** |
