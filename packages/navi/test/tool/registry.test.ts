import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@navi-ai/core/cross-spawn-spawner"
import { ToolRegistry, invalidateToolCaches } from "@/tool/registry"
import { Flag } from "@navi-ai/core/flag/flag"
import { disposeAllInstances, provideInstance, reloadTestInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { AppFileSystem } from "@navi-ai/core/filesystem"
import { Plugin } from "@/plugin"
import { Question } from "@/question"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { Reference } from "@/reference/reference"
import { Memory } from "@/memory"
import { History } from "@/history"
import { SessionStatus } from "@/session/status"

const node = CrossSpawnSpawner.defaultLayer
const originalExperimentalScout = Flag.NAVI_EXPERIMENTAL_SCOUT
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".navi")])),
})

const registryLayer = ToolRegistry.layer.pipe(
  Layer.provide(configLayer),
  Layer.provide(
    Layer.mergeAll(
      Plugin.defaultLayer,
      Question.defaultLayer,
      Todo.defaultLayer,
      Skill.defaultLayer,
      Agent.defaultLayer,
      Session.defaultLayer,
      Provider.defaultLayer,
      Git.defaultLayer,
      Reference.defaultLayer,
      LSP.defaultLayer,
      SessionStatus.defaultLayer,
    ),
  ),
  Layer.provide(
    Layer.mergeAll(
      Instruction.defaultLayer,
      AppFileSystem.defaultLayer,
      Bus.layer,
      FetchHttpClient.layer,
      Format.defaultLayer,
      node,
      Ripgrep.defaultLayer,
      Truncate.defaultLayer,
      Memory.defaultLayer,
      History.defaultLayer,
    ),
  ),
)

const it = testEffect(Layer.mergeAll(registryLayer, node))

afterEach(async () => {
  Flag.NAVI_EXPERIMENTAL_SCOUT = originalExperimentalScout
  await disposeAllInstances()
})

describe("tool.registry", () => {
  it.instance(
    "hides repo research tools unless experimental",
    () =>
      Effect.gen(function* () {
        Flag.NAVI_EXPERIMENTAL_SCOUT = false
        const registry = yield* ToolRegistry.Service
        const ids = yield* registry.ids()

        expect(ids).not.toContain("codesearch")
        expect(ids).not.toContain("repo_clone")
        expect(ids).not.toContain("repo_overview")
      }),
    30000,
  )

  it.instance("shows repo research tools when experimental scout is enabled", () =>
    Effect.gen(function* () {
      Flag.NAVI_EXPERIMENTAL_SCOUT = true
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).toContain("codesearch")
      expect(ids).toContain("repo_clone")
      expect(ids).toContain("repo_overview")
    }),
  )

  it.instance("loads tools from .navi/tool (singular)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const navi = path.join(test.directory, ".navi")
      const tool = path.join(navi, "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("loads tools from .navi/tools (plural)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const navi = path.join(test.directory, ".navi")
      const tools = path.join(navi, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("loads tools with external dependencies without crashing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const navi = path.join(test.directory, ".navi")
      const tools = path.join(navi, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(navi, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@navi-ai/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(navi, "package-lock.json"),
          JSON.stringify({
            name: "custom-tools",
            lockfileVersion: 3,
            packages: {
              "": {
                dependencies: {
                  "@navi-ai/plugin": "^0.0.0",
                  cowsay: "^1.6.0",
                },
              },
            },
          }),
        ),
      )

      const cowsay = path.join(navi, "node_modules", "cowsay")
      yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "package.json"),
          JSON.stringify({
            name: "cowsay",
            type: "module",
            exports: "./index.js",
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "index.js"),
          ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("cowsay")
    }),
  )

  describe("tool schema cache", () => {
    // The registry only reads name/mode/permission off the caller agent, so a
    // literal keeps these tests independent of the Agent service layer.
    const agent = (overrides: Partial<Agent.Info> = {}) =>
      ({
        name: "build",
        mode: "primary",
        description: "build agent",
        permission: [],
        ...overrides,
      }) as unknown as Agent.Info

    const input = (overrides: Partial<{ providerID: ProviderID; modelID: ModelID; agent: Agent.Info }> = {}) => ({
      providerID: ProviderID.make("anthropic"),
      modelID: ModelID.make("claude-sonnet-4"),
      agent: agent(),
      ...overrides,
    })

    it.instance("reuses descriptors for the same provider/model/agent", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const model = input()

        const first = yield* registry.tools(model)
        const second = yield* registry.tools(model)

        expect(second).toBe(first)
        expect(first.length).toBeGreaterThan(50)
        expect(first.map((item) => item.id)).toContain("bash")
      }),
    )

    it.instance("keys the cache by model, so the edit/apply_patch swap is not shared", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const base = input({ providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4o") })

        const gpt4 = yield* registry.tools(base)
        const gpt5 = yield* registry.tools({ ...base, modelID: ModelID.make("gpt-5") })

        expect(gpt5).not.toBe(gpt4)
        expect(gpt4.map((item) => item.id)).toContain("edit")
        expect(gpt5.map((item) => item.id)).toContain("apply_patch")
        expect(gpt5.map((item) => item.id)).not.toContain("edit")
      }),
    )

    it.instance("keys the cache by the caller's skill permissions", () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* Effect.promise(() =>
          Bun.write(
            path.join(test.directory, ".navi", "skill", "cache-demo", "SKILL.md"),
            ["---", "name: cache-demo", "description: visible skill", "---", "", "# Cache demo", ""].join("\n"),
          ),
        )
        const registry = yield* ToolRegistry.Service
        const open = yield* registry.tools(input())
        const restricted = yield* registry.tools(
          input({
            agent: agent({ name: "readonly", permission: [{ permission: "skill", pattern: "*", action: "deny" }] }),
          }),
        )

        const skillOf = (list: typeof open) => list.find((item) => item.id === "skill")!
        expect(skillOf(open).description).toContain("cache-demo")
        expect(skillOf(restricted).description).toContain("No skills are currently available.")
        expect(restricted).not.toBe(open)
      }),
    )

    it.instance("drops cached descriptors when invalidated", () =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const model = input()

        const first = yield* registry.tools(model)
        invalidateToolCaches()
        const second = yield* registry.tools(model)

        expect(second).not.toBe(first)
        expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id))
      }),
    )
  })

  describe("custom tool scan cache", () => {
    const source = (name: string) =>
      [
        "export default {",
        `  description: '${name} tool',`,
        "  args: {},",
        "  execute: async () => {",
        `    return '${name}'`,
        "  },",
        "}",
        "",
      ].join("\n")

    // Uses `provideInstance` (not `it.instance`) so the instance lives in the same
    // store as `reloadTestInstance`; only that store's reload runs disposers.
    const ids = (dir: string) =>
      provideInstance(dir)(
        Effect.gen(function* () {
          return yield* (yield* ToolRegistry.Service).ids()
        }),
      )

    it.live("re-discovers custom tools when the tools directory changes", () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped()
        const tools = path.join(dir, ".navi", "tools")
        yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
        yield* Effect.promise(() => Bun.write(path.join(tools, "alpha.ts"), source("alpha")))

        expect(yield* ids(dir)).toContain("alpha")

        // A second file changes the directory mtime, so the cached scan (TTL 30s)
        // must be revalidated instead of serving the stale match list.
        yield* Effect.promise(() => Bun.write(path.join(tools, "beta.ts"), source("beta")))
        yield* Effect.promise(() => reloadTestInstance({ directory: dir }))

        const after = yield* ids(dir)
        expect(after).toContain("alpha")
        expect(after).toContain("beta")
      }),
    )
  })
})
