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
