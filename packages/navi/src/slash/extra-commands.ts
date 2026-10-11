/**
 * Slash command stubs — mirrors Claude 80+ slash commands (claude.md §5).
 *
 * This file defines the full set of extra slash commands that Claude exposes
 * inside its Ink TUI. The Navi TUI will register these as no-op stubs so
 * `tsc` passes and completion can suggest them, without yet wiring full
 * handlers. Real handlers should be added incrementally behind flags.
 *
 * Required coverage (from task): /compact, /rewind, /thinkback, /doctor,
 * /theme, /model, /permissions, /review, /workflow
 */

export const EXTRA_COMMANDS = [
  // Navigation & Info (claude.md)
  "/help",
  "/status",
  "/files",
  "/session",
  "/cost",
  "/usage",
  // Project Setup
  "/init",
  "/add-dir",
  "/onboarding",
  "/doctor",
  // Git Operations
  "/commit",
  "/branch",
  "/diff",
  "/pr-comments",
  "/review",
  // Context Control
  "/compact",
  "/memory",
  "/clear",
  "/rewind",
  "/thinkback",
  // Configuration
  "/config",
  "/theme",
  "/color",
  "/keybindings",
  "/model",
  "/permissions",
  // Automation
  "/workflows",
  "/workflow",
  "/tasks",
  "/skills",
  "/plugin",
  "/loop",
  "/karpathy-loop",
  "/autoresearch",
  "/goal",
  "/grill-me",
  "/learn",
  "/recap",
  // Experimental
  "/voice",
  "/vim",
  "/buddy",
  "/flash",
  "/torch",
  "/bughunter",
  // Extended — planning, agents, context
  "/plan",
  "/agent",
  "/context",
  "/prompt",
  "/fork",
  "/retry",
  "/mcp",
  "/ide",
  "/terminal",
  "/sandbox",
  "/history",
  "/knowledge",
  "/search",
  "/grep",
  "/glob",
  "/read",
  "/write",
  "/edit",
  "/shell",
  "/task",
  "/todo",
  "/question",
  "/schedule",
  "/arch",
  "/lsp",
  "/browser",
  "/image",
  "/web",
  "/fetch",
  "/crawl",
  "/scrape",
  "/grounding",
  "/tavily",
  "/exa",
  "/duck",
  "/google",
  "/firecrawl",
  "/test",
  "/checkpoint",
  "/vcr",
  "/teleport",
  "/share",
  "/context-epoch",
  "/security-audit",
  "/watch-ui",
  "/agentation",
  "/acceptpr",
  "/landpr",
  "/fixissue",
  "/handoff",
  "/pickup",
  "/raise",
  "/sectriage",
  "/validate",
  "/spec",
  "/build",
  "/cso",
  "/qa",
  "/qa-only",
  "/webperf",
  "/ship",
  "/investigate",
  "/guard",
  "/careful",
  "/freeze",
  "/unfreeze",
  "/benchmark",
  "/reflect",
  "/code-simplify",
  "/constraints",
  "/diagram",
  "/ctx",
  "/ctx-stats",
  "/ctx-doctor",
  "/karpathy-guidelines",
  "/ppt",
  "/presentation",
  "/ask-matt",
  "/diagnose",
  "/domain-model",
  "/tdd",
  "/to-tickets",
  "/wayfinder",
  "/prototype",
] as const

export type ExtraCommand = (typeof EXTRA_COMMANDS)[number]

// Back-compat alias — some callers import SLASH_COMMANDS
export const SLASH_COMMANDS = EXTRA_COMMANDS

export const EXTRA_COMMANDS_SET = new Set<string>(EXTRA_COMMANDS)

export const EXTRA_COMMAND_DESCRIPTIONS: Record<string, string> = {
  "/help": "Show help and available commands",
  "/status": "Show session and system status",
  "/files": "List files in the current workspace",
  "/session": "Manage current session",
  "/cost": "Show cost and token usage (CostTracker)",
  "/usage": "Show usage statistics",
  "/init": "Initialize a new project",
  "/add-dir": "Add a directory to the workspace",
  "/onboarding": "Run onboarding flow",
  "/doctor": "Run diagnostics (mirrors /doctor from Claude)",
  "/commit": "Create a git commit",
  "/branch": "Git branch operations",
  "/diff": "Show git diff",
  "/pr-comments": "Show PR comments",
  "/review": "Code review (mirrors /review)",
  "/compact": "Compact the context (mirrors /compact)",
  "/memory": "Manage memory / context memory",
  "/clear": "Clear the session",
  "/rewind": "Rewind to a previous checkpoint (mirrors /rewind)",
  "/thinkback": "Thinkback — revisit prior reasoning (mirrors /thinkback)",
  "/config": "Manage configuration",
  "/theme": "Change theme (mirrors /theme)",
  "/color": "Change color scheme",
  "/keybindings": "Manage keybindings",
  "/model": "Switch model (mirrors /model)",
  "/permissions": "Manage permissions (mirrors /permissions)",
  "/workflows": "List workflows",
  "/workflow": "Run a workflow (mirrors /workflow)",
  "/tasks": "Manage tasks",
  "/skills": "Manage skills",
  "/plugin": "Manage plugins",
  "/voice": "Voice mode (mirrors /voice)",
  "/vim": "Vim mode (mirrors /vim)",
  "/buddy": "Buddy assistant",
  "/flash": "Flash session",
  "/torch": "Torch experimental",
  "/bughunter": "Bug hunter",
  "/security-audit": "Conduct a security audit using Cloudflare's vulnerability discovery methodology",
  "/loop": "Run autonomous Karpathy experiment loop (hypothesize -> edit -> eval -> commit/revert)",
  "/karpathy-loop": "Run autonomous Karpathy experiment loop on target metric",
  "/goal": "Execute high-perseverance autonomous goal until complete",
  "/grill-me": "Interview on requirements, edge cases, and architectural tradeoffs before coding",
  "/learn": "Extract guidelines or corrections into AGENTS.md / rules",
  "/recap": "Bounded 40-60 word session catch-up and next action (Codex pattern)",
  "/watch-ui": "Watch for visual annotations from the running app via Agentation MCP and automatically remediate code",
  "/agentation": "Manage Agentation visual feedback toolbar connection and watch mode",
  "/acceptpr": "Land one PR end-to-end (changelog + thanks, lint, merge, back to main)",
  "/landpr": "Land PR via temp-branch rebase, full gate, merge, and verification",
  "/fixissue": "Fix an issue end-to-end (tests, changelog, commit, push, comment, close)",
  "/handoff": "Capture current session state for the next agent",
  "/pickup": "Rehydrate context and onboard onto active task",
  "/raise": "Open next patch Unreleased section in CHANGELOG.md",
  "/sectriage": "Triage GitHub Security Advisory (GHSA) end-to-end",
  "/validate": "Solo founder 6-forcing-question demand and product validation before code",
  "/spec": "Write complete engineering specification and capability map before implementing",
  "/plan": "Switch to Plan mode (read-only analysis, research, and plan creation)",
  "/build": "Switch to Build mode (full implementation with edit and tool execution)",
  "/cso": "Chief Security Officer audit (secrets, dependencies, OWASP Top 10, STRIDE)",
  "/qa": "Real browser automated and interactive quality assurance with regression tests",
  "/qa-only": "Report-only browser quality assurance audit without altering source code",
  "/webperf": "Web performance engineering audit (Core Web Vitals, budgets, waterfall)",
  "/ship": "Solo founder production shipping protocol (gates, tests, bump, release)",
  "/investigate": "Systematic root-cause debugging (investigate -> analyze -> hypothesize -> remediate)",
  "/guard": "Safety guardrails: destructive command warnings and workspace scope boundaries",
  "/careful": "Warn before destructive operations (rm, drop, clean, reset)",
  "/freeze": "Freeze file edits strictly to the designated directory",
  "/unfreeze": "Clear edit freeze boundary and restore full editing permissions",
  "/benchmark": "Web performance regressions and Core Web Vitals benchmark",
  "/reflect": "Solo founder retrospective on velocity, streak, and architectural debt",
  "/code-simplify": "Simplify recently modified code for maximum clarity without semantic drift",
  "/constraints": "Establish architectural invariants and non-negotiable project quality bars",
  "/diagram": "Generate, validate, and export architecture and sequence diagrams with professional themes",
  "/ctx": "Inspect and search conversational context and living memory",
  "/ctx-stats": "Display real-time token metrics, cache ratio, and context window health",
  "/ctx-doctor": "Audit context health and identify oversized outputs or repetitive loops",
  "/karpathy-guidelines": "Apply Andrej Karpathy's core engineering constraints (Think, Simplicity, Surgical, Goal-Driven)",
  "/ppt": "Generate structured multi-slide executive presentation decks with 14+ themes",
  "/presentation": "Generate and export presentations and slides",
  "/ask-matt": "Consult TypeScript and architectural expert guidance (Matt Pocock pattern)",
  "/diagnose": "Systematically reproduce bug mutations and establish root cause before fixing",
  "/domain-model": "Establish ubiquitous domain vocabulary and Architecture Decision Records (ADRs)",
  "/tdd": "Execute Test-Driven Development with test seam analysis and mock isolation",
  "/to-tickets": "Break high-level product specifications into granular execution tickets",
  "/wayfinder": "Guide architectural navigation across unfamiliar codebases",
  "/prototype": "Rapidly scaffold logic and UI prototypes before full production hardening",
}

/**
 * Registration stub — wire into the CLI/TUI command registry.
 *
 * Usage:
 * ```ts
 * import { registerExtraCommands, EXTRA_COMMANDS } from "@/slash/extra-commands"
 * registerExtraCommands(commandRegistry)
 * ```
 */
export function registerExtraCommands(
  registry: {
    register?: (name: string, handler: (args: string) => unknown) => void
    add?: (name: string) => void
    set?: (name: string, value: unknown) => void
  } | Map<string, unknown>,
): string[] {
  const stubHandler = (cmd: string) => () => ({
    title: cmd,
    output: `Slash command ${cmd} is a stub — handler not yet implemented. See claude.md §5 and src/slash/extra-commands.ts.`,
  })

  for (const cmd of EXTRA_COMMANDS) {
    if (registry instanceof Map) {
      registry.set(cmd, { description: EXTRA_COMMAND_DESCRIPTIONS[cmd] ?? `Stub for ${cmd}`, handler: stubHandler(cmd) })
    } else if (typeof registry.register === "function") {
      registry.register(cmd, stubHandler(cmd))
    } else if (typeof registry.add === "function") {
      registry.add(cmd)
    } else if (typeof registry.set === "function") {
      registry.set(cmd, stubHandler(cmd))
    }
  }
  return [...EXTRA_COMMANDS]
}

export const ExtraCommands = {
  list: EXTRA_COMMANDS,
  set: EXTRA_COMMANDS_SET,
  descriptions: EXTRA_COMMAND_DESCRIPTIONS,
  register: registerExtraCommands,
} as const
