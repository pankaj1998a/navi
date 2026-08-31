import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@navi-ai/core/cross-spawn-spawner"
import { ToolRegistry } from "@/tool/registry"
import { Flag } from "@navi-ai/core/flag/flag"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
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
import { Git } from "@/git"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "@/session/instruction"
import { Bus } from "@/bus"
import { FetchHttpClient } from "effect/unstable/http"
import { Format } from "@/format"
import { Ripgrep } from "@/file/ripgrep"
import * as Truncate from "@/tool/truncate"
import { InstanceState } from "@/effect/instance-state"
import { Reference } from "@/reference/reference"
import { Memory } from "@/memory"
import { History } from "@/history"
import { SessionStatus } from "@/session/status"
import { BackgroundJob } from "@/background-job"

const node = CrossSpawnSpawner.defaultLayer
const originalExperimentalScout = Flag.NAVI_EXPERIMENTAL_SCOUT
const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".navi")])),
})

const registryLayer = ToolRegistry.layer.pipe(
  Layer.provide(BackgroundJob.layer),
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
  it.instance("hides repo research tools unless experimental", () =>
    Effect.gen(function* () {
      Flag.NAVI_EXPERIMENTAL_SCOUT = false
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("codesearch")
      expect(ids).not.toContain("repo_clone")
      expect(ids).not.toContain("repo_overview")
    }),
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
})
