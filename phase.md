# Navi Development Methodology

Navi is optimized for a structured, three-phase workflow to ensure high-quality code generation, minimize technical debt, and facilitate efficient agent collaboration. By separating research, planning, and implementation, we ensure that every code change is intentional, well-understood, and correctly executed.

---

## Phase 1: Research 🔍

**Goal:** Establish a deep, comprehensive understanding of the problem space, existing constraints, and requirements before any technical decisions are made.

Feed everything relevant upfront to build a foundation of understanding:
- **Architecture Diagrams**: Understand the high-level system components, their boundaries, and relationships.
- **Documentation**: Reference internal APIs, domain standards, and external library specifications.
- **Context & Discussions**: Capture context from historical discussions, decisions, edge cases, and Slack threads.
- **Runbooks & Guidelines**: Follow established operational procedures, coding conventions, and deployment standards.
- **Design Docs**: Start with the formal specification and intent of the feature or bug fix.

---

## Phase 2: Planning 📝

**Goal:** Translate research into a concrete, unambiguous technical design that outlines the exact code changes required.

Create a detailed plan with the actual code structure before any code is generated:
- **Function Signatures & Type Definitions**: Define precise interfaces and data structures.
- **Exact Flow of Data**: Map out exactly how information traverses through the system.
- **Scope & File Identification**: Pinpoint exactly which files, components, and modules need modification or creation.
- **Module Design**: Outline new functions, their specific responsibilities, and expected side effects.
- **Component Interaction**: Ensure clear, predictable, and decoupled communication between system parts.

---

## Phase 3: Implementation 🚀

**Goal:** Execute the plan with precision, ensuring the generated code strictly adheres to the approved design and standards.

Generate code only after validating both the understanding from Phase 1 and the plan from Phase 2:
- **Clear Specification**: Ensure the AI (and developer) has a focused, pre-approved blueprint to follow.
- **No Complexity Spiral**: Aim for focused, predictable outputs rather than long, wandering message chains.
- **Background Agent Strategy**: Delegate the heavy lifting to specialized background agents and move on to your next task.
- **Fast & Focused Review**: Verify conformance to the original plan rather than reverse-engineering what the AI "invented".

---

## 🤖 Subagent Orchestration (Behind-the-Scenes)

Navi natively supports a powerful multi-agent delegation pattern.

Users can mark specific models or modes as **"Favorites"**. The active **"Master" model** can then automatically leverage these favorite models by spawning them as **subagents** for behind-the-scenes tasks. 

This enables the master model to:
- **Parallelize Workloads:** Silently delegate complex sub-tasks, background research, or build processes.
- **Utilize Specialized Models:** Leverage the particular strengths of your favorite models without needing to explicitly switch contexts.
- **Maintain UI Flow:** Keep the primary interaction unblocked and clean while asynchronous heavy lifting happens in the background.

---

## 🆚 Comparison: Subagent Orchestration vs. Specs Mode

Navi currently features a dedicated **Specs** mode, which provides a structured, rigid 6-phase workflow (Requirements → Research → Design → Approval → Tasks → Execution) using persistent memory in a `.specs/` directory. 

While Specs mode ensures a pristine, step-by-step project lifecycle, **Subagent Orchestration** is a more fluid, on-the-fly delegation mechanism.

### Enhancing Specs Mode with Subagents
Currently, Specs mode relies on a single persistent context progressing sequentially. By integrating **Subagent Orchestration** into Specs mode, we can massively upgrade its capabilities:

1. **Phase Delegation:** Instead of doing all the work itself, the Specs agent can act purely as the **Project Manager / Master Orchestrator**. 
2. **Parallel Task Execution:** During the *Execution* phase in Specs mode, the master agent can spawn multiple *Favorite* coding models simultaneously to tackle different tasks from the `.specs/` directory dependency graph.
3. **Specialized Research:** During the *Research* phase, Specs can spawn a web-search heavy subagent in the background to compile a report, leaving the main Specs thread responsive.
4. **Automated Validation Gates:** When a task is marked complete, Specs can delegate a *Favorite* "Reviewer" model as a subagent to independently verify the implementation against the original design document before proceeding.
