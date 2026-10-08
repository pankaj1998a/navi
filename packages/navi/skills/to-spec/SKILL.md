---
name: to-spec
description: Synthesize conversation, requirements, and decisions into a formal engineering specification. Use when converting discussion into an actionable plan or spec document.
---

# To-Spec: Specification Synthesizer

Synthesize the current conversation and codebase knowledge into an actionable specification.

## Spec Format

```markdown
# Spec: <Feature or System Name>

## 1. Problem Statement
The user's problem from their perspective, with context on why existing solutions fall short.

## 2. Solution Overview
High-level architectural approach and user-facing outcome.

## 3. User Stories
Exhaustive, numbered user stories:
1. As an <actor>, I want <capability>, so that <benefit>.

## 4. Seams & Public Interfaces
The exact public boundaries where this feature will be invoked and tested. Avoid coupling to private internals.

## 5. Implementation Decisions
- Modules to create or modify
- Interface contracts and schemas
- State management and lifecycle

## 6. Testing Decisions
- Seam-level integration and unit tests
- Independent sources of truth for assertions
- Edge cases and regression guards

## 7. Out of Scope
Explicitly declared non-goals and deferred capabilities.
```
