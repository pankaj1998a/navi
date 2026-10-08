---
name: codebase-design
description: Shared vocabulary and principles for designing deep modules with small interfaces, clean seams, and high testability. Use when designing, refactoring, or evaluating module architecture.
---

# Codebase Design

Design **deep modules**: a lot of behavior behind a small interface, placed at a clean seam, testable through that interface.

## Vocabulary
- **Module**: Anything with an interface and an implementation (function, class, package, or subsystem).
- **Interface**: Everything a caller must know to use the module correctly (signature, invariants, error modes).
- **Implementation**: Internal mechanics hidden inside the module.
- **Depth**: Leverage at the interface. High depth = small interface + large capability. Shallow module = large interface + thin pass-through implementation.
- **Seam**: The location where a module's interface lives and behavior can be observed or altered without editing in place.
- **Leverage**: Caller benefit: more capability per unit of interface learned.
- **Locality**: Maintainer benefit: changes and verification concentrate in one place rather than scattering across callers.

## Principles
- **The Deletion Test**: Imagine deleting the module. If complexity vanishes, it was a pass-through wrapper (shallow). If complexity scatters across callers, it was earning its keep (deep).
- **The interface is the test surface**: Callers and tests cross the same seam. If you must test past the interface, the module is the wrong shape.
- **Accept dependencies, don't create them**: Pass collaborators into functions/constructors rather than instantiating inside.
- **Return results, don't produce side effects**: Pure functions and immutable transforms make testing effortless.
- **One adapter = hypothetical seam; two adapters = real seam**: Don't introduce abstractions until variance actually exists.
