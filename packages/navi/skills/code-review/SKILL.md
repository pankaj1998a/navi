---
name: code-review
description: Two-axis review of code changes along Standards (repo conventions + Fowler code smells) and Spec (fidelity vs. scope creep). Use when reviewing diffs, PRs, or working branches.
---

# Two-Axis Code Review

A change can pass standards but fail the spec (wrong behavior written cleanly), or pass the spec but fail standards (working code with severe tech debt). Review both axes independently to prevent masking.

## Axis 1: Standards & Fowler Smell Baseline
Check repository conventions (`AGENTS.md`, `CLAUDE.md`) plus the Fowler smell baseline:
- **Mysterious Name**: Names that do not clearly convey intent or contents.
- **Duplicated Code**: Identical logic repeated across files or hunks.
- **Feature Envy**: Method reaching into another module's internal data.
- **Data Clumps**: Fields or parameters that always travel together (wants a dedicated type).
- **Primitive Obsession**: Raw strings/numbers used instead of typed domain concepts with invariants.
- **Speculative Generality**: Unrequested hooks, abstractions, or configurability.
- **Shotgun Surgery**: One change forcing edits scattered across many files.
- **Divergent Change**: One file edited for multiple unrelated reasons.

## Axis 2: Spec Fidelity & Scope Creep
- **Missing Requirements**: Unimplemented requirements from the original request or spec.
- **Scope Creep**: Unrequested modifications, speculative features, or dead code.
- **Edge Cases**: Unhandled error conditions or contract mismatches.

## Structured Report Format
```markdown
## Standards Review
- [Pass/Fail/Warning]: <Observation citing file and line, naming specific standard or Fowler smell>

## Spec Review
- [Pass/Fail/Warning]: <Observation citing requirement, missing items, or scope creep>

## Summary & Verdict
- **Standards Score**: [Clean / Warnings / Critical Issues]
- **Spec Score**: [Complete / Scope Creep / Incomplete]
- **Verdict**: [APPROVED / REVISE NEEDED / BLOCKED]
```
