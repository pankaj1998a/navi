import type { OfficialCommandDefinition } from "./types"

export const OFFICIAL_COMMANDS: OfficialCommandDefinition[] = [
  {
    name: "code-review",
    description: "Automated multi-agent code review for pull requests with confidence scoring",
    template: `Provide a thorough, high-signal code review for the specified pull request or changes: $ARGUMENTS

Follow this multi-agent review process:
1. **Eligibility Check**: Check if the pull request is closed, draft, or an automated trivial bump. If so, inform the user and do not proceed.
2. **Rules Discovery**: Inspect relevant repository rules files (\`AGENTS.md\`, \`CLAUDE.md\`, or \`.rules\`) for project-specific instructions.
3. **Diff Analysis**: Inspect the git diff and summarize the core functional change.
4. **Specialized Audits**:
   - Audit adherence to project rules and architectural standards.
   - Scan for logic bugs, null safety issues, unhandled errors, and regressions.
   - Inspect git history and surrounding context for breaking changes.
5. **Confidence Scoring**: For each issue found, score confidence from 0 to 100. Filter out false positives and low-confidence nitpicks (score < 80).
6. **Findings Report**: Present findings clearly with file links, line ranges, and actionable fix suggestions. If using GitHub CLI, comment on the PR using \`gh pr comment\`.`,
    hints: ["$ARGUMENTS"],
    subtask: true,
  },
  {
    name: "review-pr",
    description: "Comprehensive PR review using specialized quality agents (tests, errors, comments, types, simplification)",
    agent: "code-reviewer",
    template: `Run a comprehensive pull request review on: $ARGUMENTS

1. Determine review scope by inspecting \`git status\` and \`git diff\`.
2. Inspect the applicable review aspects:
   - **General Quality**: Review logic, safety, and adherence to project conventions.
   - **Error Handling**: Hunt for silent failures, unhandled exceptions, and swallowed errors.
   - **Test Quality**: Check test coverage completeness, edge cases, and assertions.
   - **Type Safety**: Check invariants, discriminated unions, and type soundness.
   - **Comments & Docs**: Ensure docstrings and comments match the new code.
3. Summarize findings into **Critical Issues** (must fix before merge), **Improvements** (suggested polish), and **Verification Steps**.`,
    hints: ["$ARGUMENTS"],
    subtask: true,
  },
  {
    name: "feature-dev",
    description: "Guided 7-phase feature development workflow with codebase exploration and architecture blueprints",
    agent: "code-architect",
    template: `Guided feature development workflow for: $ARGUMENTS

Follow these phases systematically:
1. **Phase 1: Discovery**: Understand requirements, constraints, and success criteria. Ask clarifying questions if underspecified.
2. **Phase 2: Codebase Exploration**: Explore existing patterns, module boundaries, and similar implementations.
3. **Phase 3: Clarifying Questions**: Confirm edge cases, error handling, and trade-offs before writing code.
4. **Phase 4: Architecture Design**: Design the feature architecture, file modifications, data flow, and build sequence.
5. **Phase 5: Implementation**: Write clean, test-driven code strictly matching project conventions.
6. **Phase 6: Verification**: Run test suites, verify edge cases, and ensure no regressions.
7. **Phase 7: Review & Polish**: Use the code-simplifier agent to polish readability and maintainability.`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "code-simplifier",
    description: "Simplifies recently modified code for clarity, elegance, and maintainability without altering behavior",
    agent: "code-simplifier",
    template: `Analyze recently modified code or specified files: $ARGUMENTS

Apply code simplification passes:
1. Preserve exact runtime functionality and outputs.
2. Reduce unnecessary complexity, deep nesting, and redundant abstractions.
3. Replace nested ternary expressions with clean switch/if-else logic.
4. Eliminate dead code, unused parameters, and over-engineered single-use wrappers.
5. Verify tests continue to pass with zero behavioral differences.`,
    hints: ["$ARGUMENTS"],
    subtask: true,
  },
  {
    name: "commit",
    description: "Inspects staged changes and creates a clean conventional git commit",
    template: `Context:
- Current git status: !git status
- Current diff: !git diff HEAD

Based on the git diff, generate a clear, conventional commit message following the repository conventions. Stage relevant changes and execute the commit.`,
    hints: [],
  },
  {
    name: "commit-push-pr",
    description: "Stages changes, creates a conventional commit, pushes branch, and opens a GitHub pull request",
    template: `Context:
- Current git status: !git status
- Current branch: !git branch --show-current

Execute the full PR workflow:
1. Verify branch name (create a descriptive branch if on main/master).
2. Stage and commit changes with a conventional commit message.
3. Push the branch to the remote origin.
4. Create a pull request using \`gh pr create\` with a descriptive title and structured summary.`,
    hints: [],
  },
  {
    name: "clean_gone",
    description: "Prunes local git branches and worktrees whose remote tracking branches were deleted",
    template: `Execute cleanup of stale local branches that have been deleted from remote:
1. Run \`git branch -v\` to identify branches marked as \`[gone]\`.
2. Inspect \`git worktree list\` to safely remove associated worktrees first.
3. Delete stale local branches using \`git branch -D\`.
4. Report which branches and worktrees were pruned.`,
    hints: [],
  },
  {
    name: "hookify",
    description: "Creates deterministic rules or hooks from conversation analysis or user instructions",
    template: `Create a rule or hook to prevent unwanted behaviors or enforce conventions: $ARGUMENTS

1. Analyze recent conversation or user instruction for the exact friction or anti-pattern.
2. Formulate a concrete, actionable rule specifying:
   - Category and tool affected (e.g. edit, bash, git).
   - Pattern to watch for and why it is problematic.
   - Recommended correct alternative.
3. Save the rule to repository guidelines (\`AGENTS.md\`, \`CLAUDE.md\`, or hook configurations).`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "create-plugin",
    description: "Scaffolds a new modular plugin structure with manifest, skills, agents, and commands",
    template: `Scaffold a new plugin structure for: $ARGUMENTS

1. Create plugin manifest (\`plugin.json\`).
2. Scaffold directory hierarchy: \`skills/\`, \`agents/\`, \`commands/\`.
3. Provide working boilerplate examples and documentation.`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "ralph-loop",
    description: "Starts a continuous self-correcting development loop with automated task verification",
    template: `Start continuous self-correcting loop for goal: $ARGUMENTS

1. Define measurable success criteria and verification tests.
2. Loop through implementation steps.
3. Execute test verification after each step.
4. Self-correct upon failure until all acceptance criteria are met.`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "cancel-ralph",
    description: "Stops and cancels the active ralph self-correcting development loop",
    template: `Cancel active ralph loop execution and restore standard session control.`,
    hints: [],
  },
  {
    name: "new-sdk-app",
    description: "Scaffolds a new Agent SDK application in TypeScript or Python",
    template: `Scaffold an Agent SDK application: $ARGUMENTS

1. Set up project structure, package manifest, and dependencies.
2. Configure agent client, tool definitions, and message loop.
3. Provide a test suite verifying tool invocation and responses.`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "modernize",
    description: "Comprehensive codebase modernization orchestrator for legacy frameworks and patterns",
    agent: "legacy-analyst",
    template: `Execute modernization workflow for codebase: $ARGUMENTS

Phases:
1. **Assess**: Audit legacy syntax, obsolete libraries, and architectural bottlenecks.
2. **Extract Rules**: Document core business logic and state invariants.
3. **Characterization Tests**: Establish automated baseline tests before modifying code.
4. **Incremental Uplift**: Safely modernize code step-by-step with continuous test validation.
5. **Verify & Harden**: Run full test suites and security audits.`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "create-docker-mcp-tunnel",
    description: "Sets up a secure Docker tunnel for local or remote MCP servers",
    template: `Configure and start a secure Docker MCP tunnel for: $ARGUMENTS

1. Inspect target MCP server configuration.
2. Generate Docker container configuration with isolated networking.
3. Expose stdio or HTTP endpoints safely and verify connectivity.`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "revise-claude-md",
    description: "Audits, optimizes, and updates repository instructions and AGENTS.md rules files",
    template: `Audit and optimize repository rules files (\`AGENTS.md\`, \`CLAUDE.md\`, \`.rules\`): $ARGUMENTS

1. Read existing instructions and identify outdated or contradictory rules.
2. Streamline content for token efficiency and high model comprehension.
3. Update build, test, and style commands to match the current codebase.`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "skill-up",
    description: "Evaluates and evolves skills and agents using declarative eval cases and regression loops",
    template: `Evaluate and evolve the target skill: $ARGUMENTS

1. Identify the target skill and its declared behaviors.
2. Review existing eval cases or generate new declarative cases testing core functionality and edge cases.
3. Run evaluation passes and inspect rule-based and LLM judge assertions.
4. Diagnose failure evidence and iteratively improve the skill instructions.
5. Add regression test cases to permanently safeguard the fixes.`,
    hints: ["$ARGUMENTS"],
  },
  {
    name: "security-audit",
    description:
      "Conduct a security audit on the codebase or target directory following Cloudflare's vulnerability discovery methodology.",
    agent: "security-auditor",
    template: `Perform a defensive security audit using Cloudflare's vulnerability discovery harness methodology.
Target / scope: $ARGUMENTS

Workflow:
1. Determine operating mode (guidance mode for focused questions, full audit mode for comprehensive reviews).
2. Map architecture, trust boundaries, and input surfaces into a coverage ledger.
3. Conduct coverage-led hunting waves across systematic attack classes.
4. Adversarially validate candidate findings with fresh verifiers to eliminate false positives.
5. Produce structured findings (confirmed, needs_validation, rejected) with verifiable source evidence and smallest effective fixes.`,
    hints: ["$ARGUMENTS"],
  },
]

