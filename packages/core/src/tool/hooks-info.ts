import z from "zod"
import { Tool } from "./tool"
import { listHooks, loadHooks } from "../hook/registry"

/**
 * HooksInfoTool — Display all configured lifecycle hooks.
 *
 * Shows users what hooks are active, what events they subscribe to,
 * and their configuration (command, URL, or function ID).
 */
export const HooksInfoTool = Tool.define("hooks_info", {
  description: `List all configured lifecycle hooks and their current status.

Shows hooks loaded from:
- Global config: ~/.navi/hooks.json
- Project config: .navi/hooks.json
- Programmatically registered function hooks

Use this to verify your hook configuration, debug automation issues,
or understand what lifecycle events are being monitored.`,

  parameters: z.object({
    reload: z.boolean().default(false).describe("If true, reload hooks from config files before listing"),
  }),

  async execute(params, _ctx) {
    if (params.reload) {
      await loadHooks()
    }

    const hookGroups = listHooks()

    if (hookGroups.length === 0) {
      return {
        title: "Lifecycle Hooks",
        metadata: {},
        output: [
          `No lifecycle hooks configured.`,
          ``,
          `To configure hooks, create \`.navi/hooks.json\` in your project:`,
          `\`\`\`json`,
          `{`,
          `  "PreToolUse": [`,
          `    { "type": "command", "command": "./hooks/pre-tool.sh" }`,
          `  ],`,
          `  "PostToolUse": [`,
          `    { "type": "http", "url": "http://localhost:9000/webhook" }`,
          `  ]`,
          `}`,
          `\`\`\``,
          ``,
          `Supported events: SessionStart, SessionEnd, PreToolUse, PostToolUse,`,
          `PostToolUseFailure, UserPromptSubmit, SubagentStart, SubagentStop, FileChanged, ConfigChange`,
        ].join("\n"),
      }
    }

    const lines = [
      `## Active Lifecycle Hooks (${hookGroups.reduce((s, g) => s + g.hooks.length, 0)} total)`,
      ``,
    ]

    for (const { event, hooks } of hookGroups) {
      lines.push(`### ${event} (${hooks.length} hook${hooks.length !== 1 ? "s" : ""})`)
      for (const hook of hooks) {
        if (hook.type === "command") {
          lines.push(`- 🖥️ **command**: \`${hook.command}\`${hook.toolFilter ? ` (filter: ${hook.toolFilter})` : ""}`)
        } else if (hook.type === "http") {
          lines.push(`- 🌐 **http**: ${hook.url}${hook.toolFilter ? ` (filter: ${hook.toolFilter})` : ""}`)
        } else if (hook.type === "function") {
          lines.push(`- ⚙️ **function**: ${hook.id}`)
        }
      }
      lines.push(``)
    }

    return {
      title: "Lifecycle Hooks",
      metadata: {},
      output: lines.join("\n"),
    }
  },
})
