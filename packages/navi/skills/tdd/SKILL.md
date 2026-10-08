---
name: tdd
description: Test-driven development with a red-green-refactor loop. Use when writing code test-first, doing TDD, or building features with empirical automated test safety.
---

# Test-Driven Development (TDD)

TDD is the disciplined Red $\rightarrow$ Green $\rightarrow$ Refactor cycle. Tests must verify behavior through public seams, not private implementation details.

## Seams: Where Tests Live
A **seam** is the public boundary where you observe behavior without reaching inside.
- **Agree seams first**: Before writing any test, identify the public interface and seam with the user.
- Tests live at seams, never against internals. Code can change completely; tests shouldn't.
- If a test breaks when refactoring internal details while behavior is unchanged, the test was coupled to implementation details.

## Vertical Slicing (Tracer Bullets)
- **Do NOT slice horizontally**: Writing all tests first before implementation tests imagined behavior and commits to premature design.
- **Work in vertical slices**: One test $\rightarrow$ minimal code to pass $\rightarrow$ repeat.
- Each cycle responds to what the previous cycle proved.

## Anti-Patterns
- **Tautological assertions**: Assertions that recompute expected values the same way the code does (`expect(add(a, b)).toBe(a + b)`). Expected values must come from an independent source of truth (spec, worked example, known literal).
- **Implementation-coupled**: Mocking internal collaborators or verifying private methods.
- **Speculative code**: Adding code or parameters for anticipated future tests.

## The Loop
1. **Red**: Write a single failing test at the agreed seam. Run it to confirm it fails cleanly.
2. **Green**: Write *only* enough code to pass the test.
3. **Refactor**: Clean up duplication, improve naming, ensure proper typing, and re-run test suite.
