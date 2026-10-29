import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import fs from "fs"
import path from "path"

const DESCRIPTION =
  "Dynamic offensive security knowledge pack loader. Loads deep penetration testing playbooks, exploit methodologies, and tool instructions (SQLi, XSS, SSRF, IDOR, RCE, OAuth, GraphQL, AWS, Docker, Nuclei, Katana, etc.) into context."

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "load"]).annotate({
    description: "Action to perform: 'list' to see all available playbooks, or 'load' to retrieve a specific playbook",
  }),
  skill_name: Schema.optional(Schema.String).annotate({
    description:
      "Name of the skill or methodology to load (e.g. 'sql_injection', 'xss', 'ssrf', 'idor', 'agent_browser', 'graphql', 'aws', 'race_conditions')",
  }),
})

function findKnowledgeFiles(baseDir: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!fs.existsSync(baseDir)) return map

  function recurse(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        recurse(fullPath)
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const key = path.basename(entry.name, ".md").toLowerCase()
        map.set(key, fullPath)
      }
    }
  }

  recurse(baseDir)
  return map
}

export const SecuritySkillTool = Tool.define(
  "security_skill",
  Effect.gen(function* () {
    const knowledgeDir = path.resolve(__dirname, "../security/knowledge")
    const knowledgeMap = findKnowledgeFiles(knowledgeDir)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (params.action === "list") {
            const categories: Record<string, string[]> = {
              vulnerabilities: [],
              tooling: [],
              protocols: [],
              cloud: [],
              technologies: [],
              frameworks: [],
              analysis: [],
            }

            for (const [key, fullPath] of knowledgeMap.entries()) {
              const rel = path.relative(knowledgeDir, fullPath).replace(/\\/g, "/")
              const category = rel.split("/")[0] || "other"
              if (!categories[category]) categories[category] = []
              categories[category]!.push(key)
            }

            return {
              title: "Available Offensive Security Playbooks",
              output: JSON.stringify(categories, null, 2),
              metadata: { total: knowledgeMap.size } as Record<string, unknown>,
            }
          }

          if (params.action === "load") {
            if (!params.skill_name) {
              return {
                title: "Load Playbook Error",
                output: "Error: 'skill_name' is required for action 'load'. Call with action 'list' to see all playbooks.",
                metadata: { loaded: false } as Record<string, unknown>,
              }
            }

            const normalized = params.skill_name.trim().toLowerCase().replace(".md", "")
            const foundPath = knowledgeMap.get(normalized)

            if (!foundPath || !fs.existsSync(foundPath)) {
              return {
                title: "Playbook Not Found",
                output: `No offensive playbook found for '${params.skill_name}'. Call 'security_skill' with action 'list' to see available skills.`,
                metadata: { loaded: false } as Record<string, unknown>,
              }
            }

            const content = fs.readFileSync(foundPath, "utf-8")
            return {
              title: `Loaded Playbook: ${normalized}`,
              output: content,
              metadata: { loaded: true, skill: normalized, bytes: content.length } as Record<string, unknown>,
            }
          }

          return {
            title: "Security Skill Tool",
            output: `Unknown action: ${params.action}`,
            metadata: {} as Record<string, unknown>,
          }
        }),
    }
  }),
)
