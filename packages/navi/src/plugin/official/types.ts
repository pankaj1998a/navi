export type OfficialPluginCategory =
  | "development"
  | "review"
  | "security"
  | "creation"
  | "mcp"
  | "git"
  | "lsp"
  | "workflow"
  | "education"

export interface OfficialPluginManifest {
  id: string
  name: string
  description: string
  version: string
  author: {
    name: string
    email?: string
    url?: string
  }
  category: OfficialPluginCategory
  skills?: string[]
  agents?: string[]
  commands?: string[]
  lsp?: {
    language: string
    extensions: string[]
    serverPackage: string
  }
}

export interface OfficialSkillDefinition {
  name: string
  description: string
  content: string
}

export interface OfficialAgentDefinition {
  name: string
  description: string
  prompt: string
  color?: string
  mode?: "subagent" | "primary" | "all"
}

export interface OfficialCommandDefinition {
  name: string
  description: string
  agent?: string
  template: string
  hints: string[]
  subtask?: boolean
}
