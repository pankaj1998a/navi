import { Config } from "../config/config"
import z from "zod"
import { Provider } from "../provider/provider"
import { generateObject, type ModelMessage } from "ai"
import { SystemPrompt } from "../session/system"
import { Instance } from "../project/instance"
import { Truncate } from "../tool/truncation"

import PROMPT_GENERATE from "./generate.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_EXPLORE from "./prompt/explore.txt"
import PROMPT_SUMMARY from "./prompt/summary.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_ARCHITECT from "./prompt/architect.txt"
import PROMPT_ASK from "./prompt/ask.txt"
import PROMPT_DEBUG from "./prompt/debug.txt"
import PROMPT_TESTER from "./prompt/tester.txt"
import PROMPT_REFACTOR from "./prompt/refactor.txt"
import PROMPT_REVIEW from "./prompt/review.txt"
import PROMPT_ORACLE from "./prompt/oracle.txt"
import PROMPT_LIBRARIAN from "./prompt/librarian.txt"
import PROMPT_FRONTEND from "./prompt/frontend.txt"
import PROMPT_MULTIMODAL from "./prompt/multimodal.txt"
import PROMPT_RESEARCHER from "./prompt/researcher.txt"
import PROMPT_BACKEND from "./prompt/backend.txt"
import PROMPT_DEVOPS from "./prompt/devops.txt"
import PROMPT_SECURITY from "./prompt/security.txt"
import PROMPT_QA from "./prompt/qa.txt"
import PROMPT_DOCUMENTATION from "./prompt/documentation.txt"
import PROMPT_DATABASE from "./prompt/database.txt"
import PROMPT_MOBILE from "./prompt/mobile.txt"
import { PermissionNext } from "@/permission/next"
import { mergeDeep, pipe, sortBy, values } from "remeda"
import { SkillManager } from "../skill/manager"
import { Global } from "../global"
import path from "path"

export namespace Agent {
  export const skillManager = new SkillManager(path.join(Global.Path.state, "skills"))
  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      mode: z.enum(["subagent", "primary", "all"]),
      native: z.boolean().optional(),
      hidden: z.boolean().optional(),
      topP: z.number().optional(),
      temperature: z.number().optional(),
      color: z.string().optional(),
      permission: PermissionNext.Ruleset,
      model: z
        .object({
          modelID: z.string(),
          providerID: z.string(),
        })
        .optional(),
      prompt: z.string().optional(),
      options: z.record(z.string(), z.any()),
      steps: z.number().int().positive().optional(),
      categories: z.array(z.string()).optional(),
    })
    .meta({
      ref: "Agent",
    })
  export type Info = z.infer<typeof Info>

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const defaults = PermissionNext.fromConfig({
      "*": "allow",
      doom_loop: "ask",
      external_directory: {
        "*": "ask",
        [Truncate.DIR]: "allow",
        [Truncate.GLOB]: "allow",
      },
      question: "deny",
      // mirrors github.com/github/gitignore Node.gitignore pattern for .env files
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
      },
    })
    const user = PermissionNext.fromConfig(cfg.permission ?? {})

    const result: Record<string, Info> = {
      build: {
        name: "build",
        mode: "primary",
        native: true,
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
          }),
          user,
        ),
      },
      plan: {
        name: "plan",
        mode: "primary",
        native: true,
        options: {},
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            edit: {
              "*": "deny",
              ".navi/plan/*.md": "allow",
            },
          }),
          user,
        ),
      },
      general: {
        name: "general",
        mode: "subagent",
        native: true,
        options: {},
        description: `General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.`,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            todoread: "deny",
            todowrite: "deny",
          }),
          user,
        ),
      },
      explore: {
        name: "explore",
        mode: "subagent",
        native: true,
        options: {},
        description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.`,
        prompt: PROMPT_EXPLORE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            read: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
      },
      compaction: {
        name: "compaction",
        mode: "primary",
        native: true,
        hidden: true,
        options: {},
        prompt: PROMPT_COMPACTION,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
      },
      architect: {
        name: "architect",
        mode: "primary",
        native: true,
        options: {},
        description: "Specialized in high-level design, system patterns, and structural decisions.",
        prompt: PROMPT_ARCHITECT,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            edit: "deny",
          }),
          user,
        ),
      },
      ask: {
        name: "ask",
        mode: "primary",
        native: true,
        options: {},
        description: "Designed for understanding and explaining complex codebases without making changes.",
        prompt: PROMPT_ASK,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            question: "allow",
            edit: "deny",
            bash: "deny",
          }),
          user,
        ),
      },
      debug: {
        name: "debug",
        mode: "subagent",
        native: true,
        options: {},
        description: "Assists in identifying and fixing issues within the code.",
        prompt: PROMPT_DEBUG,
        permission: PermissionNext.merge(defaults, user),
      },
      tester: {
        name: "tester",
        mode: "subagent",
        native: true,
        options: {},
        description: "Focused on writing tests, analyzing coverage, and ensuring code reliability.",
        prompt: PROMPT_TESTER,
        permission: PermissionNext.merge(defaults, user),
      },
      refactor: {
        name: "refactor",
        mode: "subagent",
        native: true,
        options: {},
        description: "Specialized in improving code structure without changing its behavior.",
        prompt: PROMPT_REFACTOR,
        permission: PermissionNext.merge(defaults, user),
      },
      review: {
        name: "review",
        mode: "subagent",
        native: true,
        options: {},
        description: "Expert at code review, quality assurance, and identifying potential issues.",
        prompt: PROMPT_REVIEW,
        permission: PermissionNext.merge(defaults, user),
      },
      oracle: {
        name: "oracle",
        mode: "subagent",
        native: true,
        options: {},
        temperature: 0.1,
        description:
          "High-IQ strategic advisor for complex architecture decisions, debugging hard problems, and code review. Read-only consultation with deep reasoning capabilities.",
        prompt: PROMPT_ORACLE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            grep: "allow",
            glob: "allow",
            list: "allow",
            read: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
      },
      librarian: {
        name: "librarian",
        mode: "subagent",
        native: true,
        options: {},
        temperature: 0.1,
        description:
          "Specialized codebase understanding agent for multi-repository analysis, retrieving official documentation, and finding implementation examples using GitHub, web search, and code search. MUST BE USED when users ask to look up code in remote repositories, explain library internals, or find usage examples in open source.",
        prompt: PROMPT_LIBRARIAN,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            bash: "allow",
            grep: "allow",
            glob: "allow",
            list: "allow",
            read: "allow",
            webfetch: "allow",
            websearch: "allow",
            codesearch: "allow",
            external_directory: "allow",
          }),
          user,
        ),
      },
      frontend: {
        name: "frontend",
        mode: "subagent",
        native: true,
        options: {},
        description:
          "A designer-turned-developer who crafts stunning UI/UX even without design mockups. Specializes in visual changes: styling, layout, animation, responsive design. The visual output is always fire.",
        prompt: PROMPT_FRONTEND,
        permission: PermissionNext.merge(defaults, user),
      },
      researcher: {
        name: "researcher",
        mode: "subagent",
        native: true,
        options: {},
        description: "Expert in deep codebase exploration and information synthesis. Strictly read-only.",
        prompt: PROMPT_RESEARCHER,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            edit: "deny",
            bash: "allow",
            webfetch: "allow",
            websearch: "allow",
          }),
          user,
        ),
      },
      backend: {
        name: "backend",
        mode: "subagent",
        native: true,
        options: {},
        description: "Senior backend engineer specialized in server-side logic, APIs, and databases.",
        prompt: PROMPT_BACKEND,
        permission: PermissionNext.merge(defaults, user),
      },
      devops: {
        name: "devops",
        mode: "subagent",
        native: true,
        options: {},
        description: "Infrastructure and deployment expert. Manages CI/CD and cloud resources.",
        prompt: PROMPT_DEVOPS,
        permission: PermissionNext.merge(defaults, user),
      },
      security: {
        name: "security",
        mode: "subagent",
        native: true,
        options: {},
        description: "Senior security engineer specialized in vulnerability research and auditing. Strictly read-only.",
        prompt: PROMPT_SECURITY,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            edit: "deny",
            bash: "allow",
          }),
          user,
        ),
      },
      qa: {
        name: "qa",
        mode: "subagent",
        native: true,
        options: {},
        description: "Quality assurance and testing expert. Focused on coverage and reliability.",
        prompt: PROMPT_QA,
        permission: PermissionNext.merge(defaults, user),
      },
      documentation: {
        name: "documentation",
        mode: "subagent",
        native: true,
        options: {},
        description: "Technical writer specialized in clear, accurate, and structured documentation.",
        prompt: PROMPT_DOCUMENTATION,
        permission: PermissionNext.merge(defaults, user),
      },
      database: {
        name: "database",
        mode: "subagent",
        native: true,
        options: {},
        description: "Database administrator and optimization expert. Manages schemas and migrations.",
        prompt: PROMPT_DATABASE,
        permission: PermissionNext.merge(defaults, user),
      },
      mobile: {
        name: "mobile",
        mode: "subagent",
        native: true,
        options: {},
        description: "Senior mobile developer specialized in iOS/Android (React Native, Flutter).",
        prompt: PROMPT_MOBILE,
        permission: PermissionNext.merge(defaults, user),
      },
      multimodal: {
        name: "multimodal",
        mode: "subagent",
        native: true,
        options: {},
        temperature: 0.1,
        description:
          "Analyze media files (PDFs, images, diagrams) that require interpretation beyond raw text. Extracts specific information or summaries from documents, describes visual content. Use when you need analyzed/extracted data rather than literal file contents.",
        prompt: PROMPT_MULTIMODAL,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
            read: "allow",
            list: "allow",
            glob: "allow",
            external_directory: {
              [Truncate.DIR]: "allow",
              [Truncate.GLOB]: "allow",
            },
          }),
          user,
        ),
      },
      title: {
        name: "title",
        mode: "primary",
        native: true,
        hidden: true,
        options: {},
        temperature: 0.5,
        prompt: PROMPT_TITLE,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
      },
      summary: {
        name: "summary",
        mode: "primary",
        native: true,
        hidden: true,
        options: {},
        prompt: PROMPT_SUMMARY,
        permission: PermissionNext.merge(
          defaults,
          PermissionNext.fromConfig({
            "*": "deny",
          }),
          user,
        ),
      },
    }

    for (const [key, value] of Object.entries(cfg.agent ?? {})) {
      if (value.disable) {
        delete result[key]
        continue
      }
      let item = result[key]
      if (!item)
        item = result[key] = {
          name: key,
          mode: "all",
          permission: PermissionNext.merge(defaults, user),
          options: {},
          native: false,
        }
      if (value.model) item.model = Provider.parseModel(value.model)
      item.prompt = value.prompt ?? item.prompt
      item.description = value.description ?? item.description
      item.temperature = value.temperature ?? item.temperature
      item.topP = value.top_p ?? item.topP
      item.mode = value.mode ?? item.mode
      item.color = value.color ?? item.color
      item.hidden = value.hidden ?? item.hidden
      item.name = value.name ?? item.name
      item.steps = value.steps ?? item.steps
      item.options = mergeDeep(item.options, value.options ?? {})
      item.permission = PermissionNext.merge(item.permission, PermissionNext.fromConfig(value.permission ?? {}))
      item.categories = value.categories
    }

    // Ensure Truncate.DIR is allowed unless explicitly configured
    for (const name in result) {
      const agent = result[name]
      const explicit = agent.permission.some((r) => {
        if (r.permission !== "external_directory") return false
        if (r.action !== "deny") return false
        return r.pattern === Truncate.DIR || r.pattern === Truncate.GLOB
      })
      if (explicit) continue

      result[name].permission = PermissionNext.merge(
        result[name].permission,
        PermissionNext.fromConfig({ external_directory: { [Truncate.DIR]: "allow", [Truncate.GLOB]: "allow" } }),
      )
    }

    return result
  })

  export async function get(agent: string) {
    return state().then((x) => x[agent])
  }

  export async function list() {
    const cfg = await Config.get()
    return pipe(
      await state(),
      values(),
      sortBy([(x) => (cfg.default_agent ? x.name === cfg.default_agent : x.name === "build"), "desc"]),
    )
  }

  export async function defaultAgent() {
    return state().then((x) => Object.keys(x)[0])
  }

  export async function generate(input: { description: string; model?: { providerID: string; modelID: string } }) {
    const cfg = await Config.get()
    const defaultModel = input.model ?? (await Provider.defaultModel())
    const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID)
    const language = await Provider.getLanguage(model)
    const system = SystemPrompt.header(defaultModel.providerID)
    system.push(PROMPT_GENERATE)
    const existing = await list()
    const result = await generateObject({
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
        },
      },
      temperature: 0.3,
      messages: [
        ...system.map(
          (item): ModelMessage => ({
            role: "system",
            content: item,
          }),
        ),
        {
          role: "user",
          content: `Create an agent configuration based on this request: \"${input.description}\".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((i) => i.name).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
        },
      ],
      model: language,
      schema: z.object({
        identifier: z.string(),
        whenToUse: z.string(),
        systemPrompt: z.string(),
      }),
    })
    return result.object
  }

  export async function activateSkill(skillName: string): Promise<string> {
    const skill = skillManager.getSkill(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)
    return skill.instructions
  }
}
