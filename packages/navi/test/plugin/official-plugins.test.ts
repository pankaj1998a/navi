import { test, expect } from "bun:test"
import { Effect } from "effect"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { WithInstance } from "../../src/project/with-instance"
import {
  getOfficialPlugins,
  getOfficialSkills,
  getOfficialAgents,
  getOfficialCommands,
  OFFICIAL_PLUGINS,
} from "../../src/plugin/official"
import { Permission } from "../../src/permission"
import { Skill } from "../../src/skill"
import { Command } from "../../src/command"
import { Agent } from "../../src/agent/agent"
import { Flag } from "@navi-ai/core/flag/flag"

test("official plugins registry contains all official plugins including skill-up", () => {
  const plugins = getOfficialPlugins()
  expect(plugins.length).toBe(40)
  expect(OFFICIAL_PLUGINS.length).toBe(40)

  const ids = plugins.map((p) => p.id)
  expect(ids).toContain("code-review")
  expect(ids).toContain("code-simplifier")
  expect(ids).toContain("feature-dev")
  expect(ids).toContain("pr-review-toolkit")
  expect(ids).toContain("commit-commands")
  expect(ids).toContain("frontend-design")
  expect(ids).toContain("skill-creator")
  expect(ids).toContain("hookify")
  expect(ids).toContain("code-modernization")
  expect(ids).toContain("mcp-server-dev")
  expect(ids).toContain("mcp-tunnels")
  expect(ids).toContain("plugin-dev")
  expect(ids).toContain("playground")
  expect(ids).toContain("project-artifact")
  expect(ids).toContain("security-guidance")
  expect(ids).toContain("session-report")
  expect(ids).toContain("ralph-loop")
  expect(ids).toContain("receipts")
  expect(ids).toContain("skill-up")
  expect(ids).toContain("typescript-lsp")
  expect(ids).toContain("pyright-lsp")
  expect(ids).toContain("rust-analyzer-lsp")
  expect(ids).toContain("gopls-lsp")
})

test("official skills are well-defined and formatted", () => {
  const skills = getOfficialSkills()
  expect(skills.length).toBeGreaterThanOrEqual(16)

  const names = skills.map((s) => s.name)
  expect(names).toContain("frontend-design")
  expect(names).toContain("skill-creator")
  expect(names).toContain("writing-rules")
  expect(names).toContain("build-mcp-server")
  expect(names).toContain("agent-development")
  expect(names).toContain("command-development")
  expect(names).toContain("skill-upper")

  for (const skill of skills) {
    expect(skill.name).toBeTruthy()
    expect(skill.description).toBeTruthy()
    expect(skill.content).toContain(skill.name)
    expect(skill.location).toMatch(/^<official-plugin:/)
  }
})

test("official agents are model-agnostic and work with any model provider", () => {
  const defaults = Permission.fromConfig({ "*": "allow" })
  const user = Permission.fromConfig({})
  const agents = getOfficialAgents(defaults, user)

  const agentNames = Object.keys(agents)
  expect(agentNames).toContain("code-simplifier")
  expect(agentNames).toContain("code-reviewer")
  expect(agentNames).toContain("code-architect")
  expect(agentNames).toContain("code-explorer")
  expect(agentNames).toContain("pr-test-analyzer")
  expect(agentNames).toContain("silent-failure-hunter")
  expect(agentNames).toContain("type-design-analyzer")
  expect(agentNames).toContain("comment-analyzer")

  // Ensure no vendor-locked models are hardcoded so ANY model (OpenAI, Gemini, DeepSeek, Claude, Llama) can run them
  for (const [name, agent] of Object.entries(agents)) {
    expect(agent.name).toBe(name)
    expect(agent.prompt).toBeTruthy()
    expect(agent.permission).toBeDefined()
    // Model is deliberately left undefined so it dynamically inherits the user's active session model
    expect(agent.model).toBeUndefined()
  }
})

test("official commands are loaded with valid templates and hints", () => {
  const commands = getOfficialCommands()
  const commandNames = Object.keys(commands)

  expect(commandNames).toContain("code-review")
  expect(commandNames).toContain("review-pr")
  expect(commandNames).toContain("feature-dev")
  expect(commandNames).toContain("code-simplifier")
  expect(commandNames).toContain("commit")
  expect(commandNames).toContain("commit-push-pr")
  expect(commandNames).toContain("clean_gone")
  expect(commandNames).toContain("hookify")
  expect(commandNames).toContain("create-plugin")
  expect(commandNames).toContain("modernize")
  expect(commandNames).toContain("skill-up")

  for (const [name, cmd] of Object.entries(commands)) {
    expect(cmd.name).toBe(name)
    expect(cmd.description).toBeTruthy()
    expect(typeof cmd.template === "string" ? cmd.template.length : 1).toBeGreaterThan(0)
    expect(Array.isArray(cmd.hints)).toBe(true)
  }
})

async function withDefaultPlugins(enabled: boolean, fn: () => Promise<void>) {
  const original = Flag.NAVI_DISABLE_DEFAULT_PLUGINS
  Flag.NAVI_DISABLE_DEFAULT_PLUGINS = !enabled
  try {
    await fn()
  } finally {
    Flag.NAVI_DISABLE_DEFAULT_PLUGINS = original
  }
}

test("official skills are discovered and available by default in Skill.Service", async () => {
  await withDefaultPlugins(true, async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Effect.runPromise(
          provideInstance(tmp.path)(Skill.Service.use((svc) => svc.all())).pipe(Effect.provide(Skill.defaultLayer)),
        )
        const names = skills.map((s) => s.name)
        expect(names).toContain("frontend-design")
        expect(names).toContain("skill-creator")
        expect(names).toContain("writing-rules")
        expect(names).toContain("build-mcp-server")

        const frontendDesign = await Effect.runPromise(
          provideInstance(tmp.path)(Skill.Service.use((svc) => svc.get("frontend-design"))).pipe(
            Effect.provide(Skill.defaultLayer),
          ),
        )
        expect(frontendDesign).toBeDefined()
        expect(frontendDesign?.name).toBe("frontend-design")
        expect(frontendDesign?.description).toContain("visual design")
      },
    })
  })
})

test("official commands are available by default in Command.Service", async () => {
  await withDefaultPlugins(true, async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const commands = await Effect.runPromise(
          provideInstance(tmp.path)(Command.Service.use((svc) => svc.list())).pipe(
            Effect.provide(Command.defaultLayer),
          ),
        )
        const names = commands.map((c) => c.name)
        expect(names).toContain("code-review")
        expect(names).toContain("review-pr")
        expect(names).toContain("feature-dev")
        expect(names).toContain("code-simplifier")
        expect(names).toContain("commit")

        const reviewPr = await Effect.runPromise(
          provideInstance(tmp.path)(Command.Service.use((svc) => svc.get("review-pr"))).pipe(
            Effect.provide(Command.defaultLayer),
          ),
        )
        expect(reviewPr).toBeDefined()
        expect(reviewPr?.agent).toBe("code-reviewer")
      },
    })
  })
})

test("official agents are available by default in Agent.Service", async () => {
  await withDefaultPlugins(true, async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const agents = await Effect.runPromise(
          provideInstance(tmp.path)(Agent.Service.use((svc) => svc.list())).pipe(
            Effect.provide(Agent.defaultLayer),
          ),
        )
        const names = agents.map((a) => a.name)
        expect(names).toContain("code-simplifier")
        expect(names).toContain("code-reviewer")
        expect(names).toContain("code-architect")
        expect(names).toContain("silent-failure-hunter")

        const simplifier = await Effect.runPromise(
          provideInstance(tmp.path)(Agent.Service.use((svc) => svc.get("code-simplifier"))).pipe(
            Effect.provide(Agent.defaultLayer),
          ),
        )
        expect(simplifier).toBeDefined()
        expect(simplifier?.name).toBe("code-simplifier")
        // Model is undefined so any model runs it!
        expect(simplifier?.model).toBeUndefined()
        expect(simplifier?.prompt).toContain("Preserve Functionality")
      },
    })
  })
})

test("NAVI_DISABLE_DEFAULT_PLUGINS disables official components when set", async () => {
  await withDefaultPlugins(false, async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Effect.runPromise(
          provideInstance(tmp.path)(Skill.Service.use((svc) => svc.all())).pipe(Effect.provide(Skill.defaultLayer)),
        )
        const names = skills.map((s) => s.name)
        expect(names).not.toContain("frontend-design")
        expect(names).not.toContain("build-mcp-server")
      },
    })
  })
})
