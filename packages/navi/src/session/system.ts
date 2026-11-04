import { Context, Effect, Layer } from "effect"

import { InstanceState } from "@/effect/instance-state"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

export function provider(model: Provider.Model) {
  if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
    return [PROMPT_BEAST]
  if (model.api.id.includes("gpt")) {
    if (model.api.id.includes("codex")) {
      return [PROMPT_CODEX]
    }
    return [PROMPT_GPT]
  }
  if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
  if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
  if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
  return [PROMPT_DEFAULT]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@navi/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
            ``,
            `## Navi Built-in Capabilities & Architecture Awareness:`,
            `- The supplied tool definitions are the source of truth for this turn. Tools vary by model, permissions, configuration, and connected MCP servers. Do not invent tool names or assume every agent has identical access.`,
            `- When available, use \`tool_search\` to discover capabilities by name or description before falling back to shell commands or declaring a capability missing. Read the selected tool's schema before calling it.`,
            `- Delegate through \`task\` when available, using an exact agent name from its current description. Load relevant workflows through \`skill\`. Agent personas, skills, slash commands, and callable tools are different interfaces.`,
            `- For browser AI consultation, look for \`bridge\`; for web interaction, look for \`browser\`. Verify service readiness and authentication rather than assuming a browser profile, port, or login exists. Do not auto-apply external model output without reviewing it.`,
            `- A registered tool or slash command is not proof of a working backend. Report missing credentials, unavailable services, experimental limitations, and stub responses honestly; never describe simulated output as completed work.`,
          ].join("\n"),
        ]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "## Built-in Skills & Engineering Rigor Discipline",
          "Skills provide specialized instructions, proven workflows, and empirical engineering disciplines.",
          "IMPORTANT: Proactively use the skill tool to load relevant skills whenever a task matches their capability (e.g. diagnosing-bugs, tdd, codebase-design, code-review, security-audit, etc.).",
          "",
          "### Default Engineering Quality Standards During Coding:",
          "- **Empirical Bug Diagnosis (`diagnosing-bugs`)**: Never guess or read code to build a theory before establishing a tight, deterministic, red-capable feedback loop. Reproduce and minimise to load-bearing parts before fixing.",
          "- **Seam-Based TDD (`tdd`)**: Test behavior exclusively through public seams. Work in vertical slices (one failing test -> minimal code -> repeat); strictly avoid horizontal test dumps and tautological assertions.",
          "- **Deep Modules & Simplicity (`codebase-design`)**: Maximize interface depth (small interface, rich behavior) for high caller leverage and maintainer locality. Avoid shallow pass-through abstractions.",
          "- **Two-Axis Review (`code-review`)**: Evaluate changes along Standards (repo conventions + Fowler smells) and Spec (fidelity vs. scope creep) separately to prevent masking.",
          "- **Security & Boundary Defense (`security-audit`)**: Enforce strict trust boundaries, validate untrusted inputs, avoid injection, and never log or expose credentials.",
          "- **Strict Google Style Guidelines (`language-guidelines`)**: When writing, refactoring, or reviewing code in any language with a Google Style Guide (C++, Python, Go, Java, TypeScript, JavaScript, Rust, Shell, Swift, C#, Kotlin, Dart, HTML/CSS, etc.), strictly adhere to Google's official style guide rules (https://google.github.io/styleguide/). Consult the language-guidelines skill references before producing code.",
          "- **Cloud Architecture & Deployment Standards (`cloud-providers`)**: When architecting, deploying, or configuring cloud services on AWS, Oracle Cloud (OCI), Google Cloud (GCP), Cloudflare, or Azure, strictly follow official provider documentation and reference repositories (https://docs.aws.amazon.com/, https://docs.oracle.com/, https://docs.cloud.google.com/, https://developers.cloudflare.com/, https://learn.microsoft.com/azure).",
          "",
          "### Available Skills:",
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
