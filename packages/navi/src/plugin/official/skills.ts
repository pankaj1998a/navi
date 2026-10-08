import type { OfficialSkillDefinition } from "./types"

export const OFFICIAL_SKILLS: OfficialSkillDefinition[] = [
  {
    name: "frontend-design",
    description:
      "Guidance for distinctive, intentional visual design when building new UI or reshaping existing interfaces. Helps with aesthetic direction, typography, curated palettes, and avoiding generic templated looks.",
    content: `---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.
---

# Frontend Design

Approach this as the design lead at a top-tier product studio known for giving every project a distinct visual identity that is never mistaken for generic AI output. The user is looking for deliberate, opinionated choices about palette, typography, layout, and micro-interactions specific to their brief.

## 1. Ground your designs in the subject matter
- If the brief does not identify what the product or subject matter is, identify it first based on context or ask the user.
- The subject's industry, materials, and vernacular are where distinctive visual choices come from — a dashboard for quantitative trading requires high density and contrast; a creative tool requires expressive typography and generous whitespace.
- Build with the real content and domain terminology throughout. Avoid generic placeholders.

## 2. Typography & Hierarchy
- Typography carries the personality of the page. Use one or two font families with clear intent (e.g. Google Fonts: Inter, Space Grotesk, Plus Jakarta Sans, Outfit, DM Sans, Playfair Display).
- Establish a rigorous type scale with intentional weights, line-heights, and tracking.
- Avoid common generative AI design clichés:
  - Do NOT put one random word in an italic accent color in every headline.
  - Do NOT overuse ALL-CAPS tracked-out micro-labels above every card.
  - Keep line lengths under 80 characters for comfortable reading.

## 3. Curated Colors & Depth
- Avoid default primary colors (raw rgb red, green, blue). Use curated HSL tokens.
- Choose a dominant tone (clean dark mode, warm cream, crisp slate), coupled with a refined accent palette.
- Use subtle borders (e.g. \`border: 1px solid rgba(255, 255, 255, 0.08)\`), subtle shadows, and glassmorphism (\`backdrop-filter: blur(12px)\`) to create natural depth without heavy visual clutter.

## 4. Intentional Layout & Micro-interactions
- Use modern CSS Grid and Flexbox patterns with responsive breakpoints.
- Spend boldness in one memorable place: an interactive demo, an expressive hero moment, or dynamic data visualization.
- Ensure all interactive elements have hover and active states with smooth CSS transitions (\`transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1)\`).
- Always guarantee accessibility: visible keyboard focus states, WCAG AA contrast, and responsive layout from mobile to wide desktop.`,
  },
  {
    name: "skill-creator",
    description:
      "End-to-end skill creation, iteration, evaluation, benchmarking, and packaging. Use to author new skills, refine descriptions for accurate triggering, and benchmark skill quality.",
    content: `---
name: skill-creator
description: Create new skills, modify and improve existing skills, and measure skill performance. Use when creating a skill from scratch, optimizing an existing skill, running evals, or refining triggering descriptions.
---

# Skill Creator

A skill for creating new skills and iteratively improving them for any AI assistant model.

## Core Process

1. **Capture Intent**:
   - Determine what workflow the user wants the skill to accomplish.
   - If the conversation already contains a successful workflow, extract the tools, sequence, and patterns.
   - Define exact triggering criteria (what user intents or tasks should activate the skill).

2. **Draft the Skill**:
   - Create a clean \`SKILL.md\` file with YAML frontmatter:
     \`\`\`markdown
     ---
     name: skill-name
     description: Concise explanation of what the skill does and when to invoke it.
     ---
     \`\`\`
   - Keep instructions actionable, specific, and structured.
   - Provide concrete examples, code snippets, and edge-case guidance.

3. **Validate & Test**:
   - Create 2-3 sample prompts that represent typical user tasks for this skill.
   - Verify that the instructions are unambiguous and easily followed by any model (OpenAI, Gemini, DeepSeek, Claude, Llama).
   - Ensure the skill relies on standard tools and conventions.

4. **Iterate & Refine**:
   - Refine descriptions to maximize triggering precision.
   - Package supporting files, templates, or scripts in subdirectories alongside \`SKILL.md\` if needed.`,
  },
  {
    name: "writing-rules",
    description:
      "Guide for writing effective, deterministic behavioral rules, constraints, and hooks to prevent recurring mistakes and guide assistant behavior.",
    content: `---
name: writing-rules
description: Guide for creating effective rules, hooks, and guidelines that prevent recurring LLM mistakes and enforce project conventions.
---

# Writing Effective Rules & Guidelines

When authoring rules for AI assistants (in \`AGENTS.md\`, \`CLAUDE.md\`, or hook rules), follow these proven principles:

## 1. Actionable & Verifiable Instructions
- Write rules that specify what TO do and what NOT to do in concrete terms.
- Bad: "Write clean code."
- Good: "Do not use nested ternary expressions; use early returns or switch statements."

## 2. Surgical Scope
- Keep rules concise and grouped by domain (Testing, Git, Types, Architecture).
- Avoid bloated rules documents that consume excessive context tokens.
- Prioritize high-impact behavioral constraints over trivial stylistic minutiae.

## 3. Explicit Triggers & Fallbacks
- Clearly specify when a rule applies (e.g. "When writing database queries...", "When submitting PRs...").
- State the fallback or escalation path when requirements are ambiguous.`,
  },
  {
    name: "build-mcp-server",
    description:
      "Architecture and implementation guide for building Model Context Protocol (MCP) servers to expose tools, resources, and prompts to AI assistants.",
    content: `---
name: build-mcp-server
description: Use when designing, creating, or debugging Model Context Protocol (MCP) servers in TypeScript or Python.
---

# Building Model Context Protocol (MCP) Servers

Guide to designing robust, model-agnostic MCP servers that integrate with Navi, Claude, OpenAI, Gemini, and any MCP-compliant client.

## Core Architecture

An MCP server exposes three primary capabilities over JSON-RPC (via stdio or SSE/HTTP):
1. **Tools**: Callable functions with JSON Schema input definitions that models can invoke.
2. **Resources**: Read-only contextual data (files, logs, metrics, schemas) accessible by URI.
3. **Prompts**: Parameterized workflow templates that assist users with structured tasks.

## Design Best Practices

- **Minimal & Focused Toolsets**: Group related actions cleanly. Avoid exposing hundreds of fine-grained API endpoints directly; provide cohesive abstractions.
- **Strict JSON Schemas**: Clearly describe every parameter, type, and whether it is required. Models of all providers rely on accurate schemas.
- **Meaningful Return Values**: Always return structured text or JSON with clear status codes and error descriptions. Never fail silently.
- **Stdio Transport**: For local plugins and CLI integrations, implement standard stdio transport reading from \`process.stdin\` and writing to \`process.stdout\`. Log debug output to \`process.stderr\` to avoid corrupting protocol messages.`,
  },
  {
    name: "build-mcp-app",
    description:
      "Guide for building rich visual applications and interactive UI widgets on top of Model Context Protocol (MCP) servers.",
    content: `---
name: build-mcp-app
description: Use when designing interactive UI widgets, dashboards, or embedded web views powered by MCP tools.
---

# Building MCP Applications & Visual Widgets

Guide for developing rich interactive frontend applications that communicate with MCP servers.

- Use standard Web technologies (HTML, CSS, modern JavaScript).
- Design self-contained widgets that render cleanly inside webview sandboxes or browser frames.
- Use JSON-RPC messages over postMessage or WebSocket to query the underlying MCP server.
- Ensure dark mode and light mode compatibility with responsive layouts.`,
  },
  {
    name: "build-mcpb",
    description:
      "Guide for packaging, bundling, and distributing MCP extensions and servers as standalone bundles.",
    content: `---
name: build-mcpb
description: Use when packaging, testing, or publishing Model Context Protocol server bundles (MCPB).
---

# MCP Bundle (MCPB) Packaging

- Ensure all dependencies are bundled or self-contained.
- Provide a clear manifest with binary path, arguments, environment variables, and required permissions.
- Validate that the server launches cleanly with stdio without external runtime prerequisites.`,
  },
  {
    name: "agent-development",
    description:
      "Guide for designing, prompting, and configuring specialized subagents and specialist personas.",
    content: `---
name: agent-development
description: Use when designing and creating specialized agent definitions, prompts, permission rules, and subagent workflows.
---

# Agent Development Guide

Specialized subagents allow decomposing complex software tasks into focused, expert roles.

## Anatomy of an Agent
1. **Role & Identity**: What specific problem space does this agent own?
2. **System Prompt**: Clear instructions, workflow phases, checklists, and output formatting.
3. **Permissions**: Restrict tools to only what is needed (e.g. read-only auditor vs full developer).
4. **Model Agnostic Prompting**: Never rely on vendor-specific model assumptions. State instructions clearly so GPT-4o, Gemini, DeepSeek, and Claude execute them with equal precision.`,
  },
  {
    name: "command-development",
    description:
      "Guide for creating slash commands with arguments, interactive templates, and subtask execution.",
    content: `---
name: command-development
description: Use when designing, authoring, or refining slash commands in Navi and agent environments.
---

# Slash Command Development Guide

Slash commands allow users to trigger standardized multi-step prompts or subagents with single keywords (e.g. \`/commit\`, \`/review-pr\`, \`/feature-dev\`).

## Command Design
- Use \`$ARGUMENTS\` for freeform user input.
- Use \`$1\`, \`$2\` for positional parameters.
- Provide clear descriptions and usage hints.
- Link commands to specialized agents when deep domain expertise is required.`,
  },
  {
    name: "hook-development",
    description:
      "Guide for developing lifecycle hooks, event listeners, and pre/post-execution interceptors.",
    content: `---
name: hook-development
description: Use when designing lifecycle hooks, event handlers, and guardrails in agent frameworks.
---

# Lifecycle Hook Development

Hooks allow intercepting session events, tool calls, and user messages to enforce constraints and automate background tasks.

- **Pre-execution Hooks**: Validate inputs, check permissions, and inject context.
- **Post-execution Hooks**: Format outputs, run automated linters, and log telemetry.
- **Event Listeners**: React to session errors, file edits, and tool results asynchronously.`,
  },
  {
    name: "mcp-integration",
    description:
      "Guide for configuring and connecting external MCP servers to agent runtimes.",
    content: `---
name: mcp-integration
description: Use when integrating external MCP servers into Navi configuration.
---

# MCP Integration Guide

Integrate external MCP servers into \`navi.json\` or workspace configuration:
\`\`\`json
{
  "mcp": {
    "my-server": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": {
        "API_KEY": "..."
      }
    }
  }
}
\`\`\`
Verify tool availability, prompt templates, and resource access.`,
  },
  {
    name: "plugin-structure",
    description:
      "Guide for structuring, organizing, and maintaining modular plugins with manifests, skills, and agents.",
    content: `---
name: plugin-structure
description: Guide to plugin folder hierarchy, manifests, skills, agents, and commands.
---

# Plugin Structure Reference

A well-structured plugin contains:
- \`.claude-plugin/plugin.json\` or \`plugin.json\`: Manifest with name, version, description.
- \`skills/\`: Directories each containing \`SKILL.md\` and references.
- \`agents/\`: Markdown files defining specialized agent roles.
- \`commands/\`: Markdown files defining slash command templates.
- \`hooks/\`: Lifecycle hook scripts and configurations.`,
  },
  {
    name: "playground",
    description:
      "Visual sandbox and prototyping skill for interactive component mockups, diff review, and concept mapping.",
    content: `---
name: playground
description: Prototyping, visual concept exploration, and interactive component sandboxing.
---

# Visual Playground & Prototyping

Use this skill when exploring UI concepts, creating working demonstrations, or presenting visual options:
- Build standalone prototypes using clean HTML/CSS/JS.
- Provide interactive controls to toggle states, themes, and layouts.
- Emphasize visual clarity and responsive design.`,
  },
  {
    name: "project-artifact",
    description:
      "Generates structured software engineering artifacts, system blueprints, and architecture dashboards.",
    content: `---
name: project-artifact
description: Software engineering architecture artifacts, system maps, and status dashboards.
---

# Project Artifacts

Generates persistent, structured project documentation:
- Architecture Decision Records (ADRs)
- System dependency diagrams and data flows
- Sprint task breakdowns and delivery roadmaps`,
  },
  {
    name: "session-report",
    description:
      "Analyzes session performance, tool usage patterns, token efficiency, and completion metrics.",
    content: `---
name: session-report
description: Session analytics, tool usage telemetry, and task completion reports.
---

# Session Reporting

Audit and report session metrics:
- Total tool invocations by category (bash, read, edit, write, grep)
- Estimated token consumption and execution latency
- Tasks completed vs errors encountered`,
  },
  {
    name: "receipts",
    description:
      "Task accounting, execution trace mining, and verifiable task completion receipts.",
    content: `---
name: receipts
description: Verifiable task completion receipts and execution trace mining.
---

# Task Receipts & Verification

Creates auditable evidence records of completed actions:
- Files modified and git diff hashes
- Test run results and assertion counts
- Verification commands and exit codes`,
  },
  {
    name: "math-olympiad",
    description:
      "Rigorous step-by-step mathematical reasoning, Olympiad-level proofs, and formal verification.",
    content: `---
name: math-olympiad
description: Rigorous mathematical problem solving, formal proofs, and Olympiad competition techniques.
---

# Mathematical Olympiad Reasoning

- State propositions and definitions with mathematical precision.
- Break proofs into explicit lemmas and base cases.
- Exhaustively verify edge cases and boundary conditions.
- Avoid vague steps or intuitive leaps without algebraic/logical justification.`,
  },
  {
    name: "claude-security",
    description:
      "Security scanning, vulnerability auditing, patch generation, and verification workflows.",
    content: `---
name: claude-security
description: Application security auditing, vulnerability scanning, and patch verification.
---

# Security Vulnerability Auditing

- Inspect codebases for OWASP Top 10 vulnerabilities (SQLi, XSS, SSRF, IDOR, Command Injection).
- Audit third-party dependencies for known CVEs.
- Generate minimal, surgical security patches.
- Verify patches with regression tests that confirm the vulnerability is closed without breaking legitimate traffic.`,
  },
  {
    name: "claude-md-improver",
    description:
      "Audit, refine, and optimize repository rules files (AGENTS.md, CLAUDE.md) for maximum clarity and token efficiency.",
    content: `---
name: claude-md-improver
description: Keep repository guidelines and rules files up-to-date, concise, and actionable.
---

# Repository Guidelines & Rules Maintenance

- Review \`AGENTS.md\`, \`CLAUDE.md\`, and project rules.
- Eliminate outdated, conflicting, or redundant instructions.
- Ensure all rules are concrete, testable, and directly useful to AI coding assistants.`,
  },
  {
    name: "claude-automation-recommender",
    description:
      "Analyzes codebase structure and recommends tailored scripts, tools, and automation skills.",
    content: `---
name: claude-automation-recommender
description: Inspect codebase structure and recommend automations, workflows, and developer tools.
---

# Automation Recommender

- Detect framework, package manager, and build system.
- Recommend pre-commit hooks, CI workflows, and custom subagents tailored to the project.`,
  },
  {
    name: "skill-upper",
    description:
      "Evaluates, tests, and iteratively evolves Agent Skills and agents with declarative test suites, rule-based checks, and regression cases.",
    content: `---
name: skill-upper
description: Evaluate Agent Skills and agents, diagnose failures, and drive continuous skill evolution with declarative eval cases and regression loops.
---

# Skill-Upper: Agent Skill Evaluation & Evolution

Use this skill to evaluate, verify, and iteratively improve Agent Skills and agents.

## Core Process

1. **Locate Target Skill**:
   - Locate \`SKILL.md\` and inspect its declared capabilities, triggers, and expected behaviors.

2. **Scaffold or Inspect Evals**:
   - Check if \`evals/eval.yaml\` and \`evals/cases/<case-id>.yaml\` exist.
   - If not, scaffold them with realistic input prompts that test core behaviors and edge cases.
   - Choose optimal judging strategies:
     - \`rule_based\`: Fast deterministic checks (must_contain, must_not_contain, tool_calls, modified files).
     - \`agent_judge\`: LLM-as-judge evaluation against criteria with pass thresholds.
     - \`script\`: Automated verification scripts.

3. **Execute & Grade**:
   - Run the cases against the agent engine and model.
   - Review assertion results, pass rates, and failure evidence.

4. **Iterative Evolution**:
   - For every failure, determine if the Skill prompt or the test case needs correction.
   - Update \`SKILL.md\` to eliminate ambiguities and prevent regressions.
   - Add permanent regression cases for identified bugs and rerun until all cases pass.`,
  },
  {
    name: "security-audit",
    description:
      "Cloudflare security guidance and vulnerability audit for codebases, APIs, services, and libraries. Supports guidance mode (focused queries/remediation) and full audit mode (reconnaissance, coverage-led hunting, adversarial validation, structured findings.json, and REPORT.md).",
    content: `---
name: security-audit
description: Security guidance and vulnerability review for codebases, APIs, services, CLI tools, libraries, and daemons. Use for security questions, focused reviews, vulnerability research, security audits, or pen tests. Run the complete workflow only for explicit codebase audit or pen-test requests, full/comprehensive/end-to-end reviews, or requested report artifacts.
---

# Security Audit (Cloudflare Vulnerability Discovery Harness)

Find vulnerabilities that violate a real trust boundary, then give owners the source evidence, safe reproduction, priority, and smallest effective fix. This is a defensive, source-first workflow. A candidate without a concrete affected principal, resource, or security outcome is not a confirmed finding.

## Operating Modes

This skill is guidance by default. Loading it does not authorize the complete audit workflow or file creation.

- **Guidance mode**: For security questions, focused reviews, methodology, triage, or investigation of specific findings, use only the relevant parts of this skill. Do not automatically run all six phases, create an output directory, or write audit artifacts.
- **Full audit mode**: Use the complete workflow when the user explicitly asks to audit or pen-test a codebase, asks for a full/comprehensive/end-to-end security review, or requests report artifacts. Run all six phases and write structured output.

## Universal Execution Safety

1. **Read-only source**: Target source inspection is read-only. Never modify target files during an audit.
2. **Local sandboxed execution**: Run target-controlled tests or fixtures only with no external network, sanitized environment, and within scratch boundaries.
3. **Dummy credentials**: Use dummy principals, mock tokens, and fixtures. Never probe deployed endpoints, external services, or production infrastructure.
4. **No weaponization**: Stop at the minimum boundary result (wrong return value, unauthorized record, sanitizer finding). Do not write exploits, persistence, or payload delivery tools.

## The 6-Phase Audit Workflow

1. **Phase 1: Reconnaissance**
   - Map architecture, trust boundaries, entrypoints, and input surfaces into \`architecture.md\`.
   - Seed the initial deterministic coverage ledger in \`coverage-ledger.json\`.
   - Units are structured as \`surface\` × \`boundary\` × \`attack_class\` × \`subsystem\`.

2. **Phase 2: Coverage-Led Hunting Waves**
   - Assign isolated hunter subagents to coverage ledger units.
   - Hunters follow systematic attack classes: Injection, Auth Bypass, IDOR, SSRF, Deserialization, Memory Safety, LLM/Agent hijacking, Logic Flaws.
   - Run coverage critics between waves to detect blind spots and unexamined code paths.

3. **Phase 3: Candidate Validation**
   - Adversarial validation: The agent that validates a candidate is never the agent that found it.
   - Every candidate is given to a fresh verifier that actively tries to disprove the finding.
   - A candidate survives only with a complete source trace and verified boundary violation.

4. **Phase 4: Structured Output**
   - Write all records to \`findings.json\` matching \`report-schema.json\`:
     - \`confirmed\`: Complete source trace, bounded observed result, and validated impact.
     - \`needs_validation\`: Plausible hypothesis blocked by missing deployment fact or sandbox limitation.
     - \`rejected\`: Disproved candidate with reason for rejection.
   - Validate findings and coverage with \`validate-findings.cjs\` and \`validate-coverage-ledger.cjs\`.

5. **Phase 5: Independent Record Verification**
   - A fresh agent independently verifies final source line references and claims to prevent hallucinations.

6. **Phase 6: Target-Neutral Reporting**
   - Generate \`REPORT.md\` (executive summary, methodology, coverage statement, confirmed findings table).
   - Generate \`FINDINGS-DETAIL.md\` (deep dive with source code snippets, affected boundaries, and smallest effective source fix).
   - Generate \`NEEDS-VALIDATION.md\` (blocked leads with exact owner validation plan).

## Severity Calibration

- **Critical**: Unauthenticated RCE, arbitrary account takeover, or full database exfiltration.
- **High**: Complete defeat of explicit security control (auth bypass, cross-tenant read/write, stored XSS).
- **Medium**: Boundary violation with limited blast radius or narrow preconditions.
- **Low**: Information disclosure of non-secret internals or defense-in-depth weakening.
- **Needs Validation**: No severity assigned (blocked lead, never an under-confident bug).`,
  },
  {
    name: "diagnosing-bugs",
    description:
      "Disciplined 6-phase diagnosis loop for bugs, crashes, and performance regressions. Use when diagnosing or debugging issues, or when something is broken, throwing, or slow.",
    content: `---
name: diagnosing-bugs
description: Disciplined diagnosis loop for bugs, crashes, and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken, throwing, failing, or slow.
---

# Diagnosing Bugs

A disciplined 6-phase protocol for isolating and fixing bugs.

## Phase 1: Build a Feedback Loop (MANDATORY GATE)
Never read code or formulate hypotheses before this loop exists.
- Build a fast, deterministic, agent-runnable command that goes RED on this specific symptom (e.g. failing test, curl command, CLI runner, throwaway harness).
- Execute the command and observe the failure.
- If impossible to construct, stop and ask the user for fixtures, credentials, or environment access.

## Phase 2: Reproduce & Minimise
- Verify the loop reproduces the user's exact symptom, not an adjacent issue.
- Minimise inputs, callers, and configs one at a time. Stop when every remaining element is load-bearing.

## Phase 3: Hypothesise
- Formulate 3–5 ranked, falsifiable hypotheses.
- Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."
- Present ranked hypotheses to the user before testing.

## Phase 4: Targeted Instrumentation
- Test one hypothesis at a time.
- Tag every debug log with a unique prefix (e.g. \`[DEBUG-a4f2]\`) so cleanup is a single grep.
- For performance issues, establish baseline measurements (timers, profiler) before editing code.

## Phase 5: Fix + Regression Test
- Write a regression test at the public seam where the bug pattern manifests.
- Watch it go RED.
- Apply the minimal fix to turn it GREEN.
- Re-run Phase 1 loop against the un-minimised repro.

## Phase 6: Cleanup
- Ensure original repro and regression test pass.
- Remove ALL \`[DEBUG-...]\` logs and throwaway harnesses.
- Record the verified root cause in the commit/summary.`,
  },
  {
    name: "tdd",
    description:
      "Test-driven development with a disciplined red-green-refactor loop. Use when writing code test-first, doing TDD, or implementing features with unit/integration tests.",
    content: `---
name: tdd
description: Test-driven development with a red-green-refactor loop. Builds features or fixes bugs one vertical slice at a time.
---

# Test-Driven Development

## Seams: Where Tests Live
- Tests verify behavior through public seams, never private internals.
- Agree the public seam with the user before writing tests.
- Code can change entirely; tests shouldn't. If a test breaks when refactoring internal details while behavior is unchanged, the test is coupled to implementation.

## Vertical Slicing (Tracer Bullets)
- Do NOT write all tests first (horizontal slicing). Horizontal slicing tests imagined behavior.
- Work in vertical slices: one test at a seam -> minimal implementation to pass -> repeat. Each slice responds to what the previous cycle proved.

## Anti-Patterns
- **Tautological assertions**: Assertions that recompute expected values the same way the code does (\`expect(add(a, b)).toBe(a + b)\`). Assertions must come from an independent truth.
- **Implementation-coupled**: Mocking internal collaborators or asserting private methods.

## The Loop
1. **Red**: Write a single failing test at the agreed seam. Run it to verify failure.
2. **Green**: Write only enough code to pass. No speculative features.
3. **Refactor**: Clean up duplication, polish types, re-run tests to confirm safety.`,
  },
  {
    name: "codebase-design",
    description:
      "Shared vocabulary and principles for designing deep modules with small interfaces, clean seams, and high testability. Use when designing, refactoring, or evaluating module architecture.",
    content: `---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when designing or improving module interfaces, deciding where seams go, making code more testable, or reducing architectural friction.
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
- **Return results, don't produce side effects**: Pure functions and immutable transforms make testing effortless.`,
  },
  {
    name: "code-review",
    description:
      "Two-axis review of code changes along Standards (repo conventions + Fowler code smells) and Spec (fidelity vs. scope creep). Use when reviewing diffs, PRs, or working branches.",
    content: `---
name: code-review
description: Review changes since a fixed point along two axes: Standards (conventions + Fowler smells) and Spec (originating requirements + scope creep).
---

# Two-Axis Code Review

A change can pass standards but fail the spec (wrong behavior written cleanly), or pass the spec but fail standards (working code with severe tech debt). Review both axes independently to prevent masking.

## Axis 1: Standards & Fowler Smell Baseline
Check repository conventions (\`AGENTS.md\`, \`CLAUDE.md\`) plus the Fowler smell baseline:
- **Mysterious Name**: Names that do not clearly convey intent or contents.
- **Duplicated Code**: Identical logic repeated across files or hunks.
- **Feature Envy**: Method reaching into another module's internal data.
- **Data Clumps**: Fields or parameters that always travel together (wants a type).
- **Primitive Obsession**: Raw strings/numbers used instead of typed domain concepts.
- **Speculative Generality**: Unrequested hooks, abstractions, or configurability.
- **Shotgun Surgery**: One change forcing edits scattered across many files.
- **Divergent Change**: One file edited for multiple unrelated reasons.

## Axis 2: Spec Fidelity & Scope Creep
- **Missing Requirements**: Unimplemented requirements from the original request/spec.
- **Scope Creep**: Unrequested modifications, speculative features, or dead code.
- **Edge Cases**: Unhandled error conditions or contract mismatches.

## Structured Report
Report findings under \`## Standards\` and \`## Spec\`, followed by a verdict (\`APPROVED\`, \`REVISE NEEDED\`, or \`BLOCKED\`).`,
  },
  {
    name: "grilling",
    description:
      "Relentless requirements and design interrogation to eliminate assumptions before implementing. Use when stress-testing a plan, scoping a complex feature, or asking clarifying questions.",
    content: `---
name: grilling
description: Grill the user relentlessly about a plan, decision, or architecture. Use when stress-testing thinking, scoping complex features, or clarifying requirements before writing code.
---

# Grilling: Design Tree Interrogation

Interview the user systematically until reaching a complete, shared understanding.

## Design Tree & The Frontier
- Map the problem as a **Design Tree**: every major decision branches into dependent decisions.
- The **Frontier** is the set of questions whose prerequisites are already settled.
- Work the tree in **rounds**: Ask the whole frontier in one batch with clear numbers and recommended options:

\`\`\`markdown
❓ **Q1 - <Question Title>**: <Context and choices>
➡️ **Recommended**: <Your recommended answer and rationale>

---

❓ **Q2 - <Question Title>**: <Context and choices>
➡️ **Recommended**: <Your recommended answer and rationale>
\`\`\`

## Rules of Grilling
- **Finding facts is the agent's job**: Never ask the user for information you can discover using search, read, bash, or subagents.
- **Making decisions is the user's job**: Put explicit choices to the user with recommendations.
- **The frontier is empty when done**: Conclude only when all branches are settled and no assumptions remain silent.`,
  },
  {
    name: "to-spec",
    description:
      "Synthesize conversation, requirements, and decisions into a formal engineering specification. Use when converting discussion into an actionable plan or spec document.",
    content: `---
name: to-spec
description: Turn conversation context and decisions into an engineering specification without asking further questions.
---

# To-Spec: Specification Synthesizer

Synthesize the current conversation and codebase knowledge into an actionable specification.

## Spec Format

\`\`\`markdown
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
\`\`\``,
  },
]



