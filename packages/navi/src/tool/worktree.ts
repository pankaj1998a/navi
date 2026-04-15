import z from "zod"
import { Tool } from "./tool"
import { Worktree } from "../worktree"

/**
 * EnterWorktreeTool — Create and enter a new git worktree for parallel development.
 *
 * Git worktrees allow multiple branches to be checked out simultaneously,
 * enabling the AI to work on isolated tasks without disrupting the main workspace.
 */
export const EnterWorktreeTool = Tool.define("worktree_enter", {
  description: `Create a new git worktree for isolated parallel development.

A git worktree allows you to work on a separate branch in a dedicated directory,
without affecting your current workspace. This enables:
- Running multiple tasks in parallel without branch switching
- Testing changes in isolation
- Working on hotfixes while a feature is in progress

After creating the worktree, you'll get a directory path. Use the bash tool
with workdir set to that path to run commands in the worktree context.

Note: Requires a git repository.`,

  parameters: z.object({
    name: z
      .string()
      .optional()
      .describe("Optional name for the worktree branch (e.g. 'fix-login-bug'). Auto-generated if not provided."),
    startCommand: z
      .string()
      .optional()
      .describe("Optional shell command to run after creating the worktree (e.g. 'npm install')"),
  }),

  async execute(params, _ctx) {
    const info = await Worktree.create({
      name: params.name,
      startCommand: params.startCommand,
    })

    return {
      title: `Worktree: ${info.name}`,
      metadata: {},
      output: [
        `✅ Git worktree created successfully.`,
        ``,
        `**Name**: ${info.name}`,
        `**Branch**: ${info.branch}`,
        `**Directory**: ${info.directory}`,
        ``,
        `To work in this worktree, use the \`bash\` tool with:`,
        `\`workdir: "${info.directory}"\``,
        ``,
        `When done, use \`worktree_exit\` with directory="${info.directory}" to clean up.`,
      ].join("\n"),
    }
  },
})

/**
 * ExitWorktreeTool — Remove a git worktree and clean up.
 */
export const ExitWorktreeTool = Tool.define("worktree_exit", {
  description: `Remove a git worktree and delete its branch when done.

Use this after completing work in a worktree to:
- Free up disk space
- Remove the dedicated branch
- Clean up the git worktree list`,

  parameters: z.object({
    directory: z.string().describe("Full path to the worktree directory to remove"),
  }),

  async execute(params, _ctx) {
    await Worktree.remove({ directory: params.directory })
    return {
      title: `Removed worktree: ${params.directory}`,
      metadata: {},
      output: `✅ Worktree at "${params.directory}" has been removed and its branch deleted.`,
    }
  },
})

/**
 * ResetWorktreeTool — Reset a worktree to the latest upstream state.
 */
export const ResetWorktreeTool = Tool.define("worktree_reset", {
  description: `Reset a git worktree to the latest state from the upstream/default branch.

Use this to refresh a worktree with the latest changes from the main branch
before starting a new task in it.`,

  parameters: z.object({
    directory: z.string().describe("Full path to the worktree directory to reset"),
  }),

  async execute(params, _ctx) {
    await Worktree.reset({ directory: params.directory })
    return {
      title: `Reset worktree: ${params.directory}`,
      metadata: {},
      output: `✅ Worktree at "${params.directory}" has been reset to the latest upstream state.`,
    }
  },
})
