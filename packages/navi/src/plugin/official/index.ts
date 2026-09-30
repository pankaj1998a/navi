import type { Plugin as PluginInstance } from "@navi-ai/plugin"
import { Permission } from "@/permission"
import type { Info as AgentInfo } from "@/agent/agent"
import type { Info as SkillInfo } from "@/skill"
import type { Info as CommandInfo } from "@/command"
import { OFFICIAL_PLUGINS } from "./registry"
import { OFFICIAL_SKILLS } from "./skills"
import { OFFICIAL_AGENTS } from "./agents"
import { OFFICIAL_COMMANDS } from "./commands"

export * from "./types"
export * from "./registry"
export * from "./skills"
export * from "./agents"
export * from "./commands"

export function getOfficialPlugins() {
  return OFFICIAL_PLUGINS
}

export function getOfficialSkills(): SkillInfo[] {
  return OFFICIAL_SKILLS.map((skill) => ({
    name: skill.name,
    description: skill.description,
    location: `<official-plugin:${skill.name}>`,
    content: skill.content,
  }))
}

export function getOfficialAgents(
  defaults: Permission.Ruleset,
  user: Permission.Ruleset,
): Record<string, AgentInfo> {
  const permission = Permission.merge(defaults, user)
  const result: Record<string, AgentInfo> = {}

  for (const agent of OFFICIAL_AGENTS) {
    result[agent.name] = {
      name: agent.name,
      description: agent.description,
      prompt: agent.prompt,
      color: agent.color ?? "gray",
      mode: agent.mode ?? "subagent",
      native: true,
      options: {},
      permission,
      // NOTE: model is deliberately left undefined so the agent seamlessly inherits
      // the user's active/configured model (OpenAI, Gemini, DeepSeek, Claude, Bedrock, Ollama, etc.)
    }
  }

  return result
}

export function getOfficialCommands(): Record<string, CommandInfo> {
  const result: Record<string, CommandInfo> = {}

  for (const cmd of OFFICIAL_COMMANDS) {
    result[cmd.name] = {
      name: cmd.name,
      description: cmd.description,
      agent: cmd.agent,
      source: "command",
      template: cmd.template,
      hints: cmd.hints,
      subtask: cmd.subtask,
    }
  }

  return result
}

export const OfficialPluginsPlugin: PluginInstance = async (_input) => {
  return {
    async config(cfg) {
      // Expose official plugins in runtime config if not explicitly disabled
      return cfg
    },
  }
}
