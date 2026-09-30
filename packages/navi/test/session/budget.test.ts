import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Image } from "@/image/image"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import * as Log from "@navi-ai/core/util/log"
import { CrossSpawnSpawner } from "@navi-ai/core/cross-spawn-spawner"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { Database } from "@/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { eq } from "drizzle-orm"

void Log.init({ print: false })

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
  cost = 0,
  tokens = 0,
) {
  const session = yield* Session.Service
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost,
    tokens: {
      total: tokens,
      input: tokens / 2,
      output: tokens / 2,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  LLM.defaultLayer,
  Provider.defaultLayer,
  status,
).pipe(Layer.provideMerge(infra))
const env = Layer.mergeAll(
  TestLLMServer.layer,
  SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provide(Image.defaultLayer), Layer.provideMerge(deps)),
)

const it = testEffect(env)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

describe("Session Budget Enforcement Tests", () => {
  it.live("should sum costs and tokens across the session hierarchy in getTreeUsage", () =>
    provideTmpdirServer(
      ({ dir }) =>
        Effect.gen(function* () {
          const { session } = yield* boot()

          const root = yield* session.create({})
          const rootUser = yield* user(root.id, "root query")
          yield* assistant(root.id, rootUser.id, path.resolve(dir), 0.015, 150)

          const child = yield* session.create({ parentID: root.id })
          const childUser = yield* user(child.id, "child query")
          yield* assistant(child.id, childUser.id, path.resolve(dir), 0.025, 250)

          const grandchild = yield* session.create({ parentID: child.id })
          const grandchildUser = yield* user(grandchild.id, "grandchild query")
          yield* assistant(grandchild.id, grandchildUser.id, path.resolve(dir), 0.01, 100)

          const usage = yield* Session.getTreeUsage(root.id)
          expect(usage.cost).toBeCloseTo(0.05, 5)
          expect(usage.tokens).toBe(500)
        }),
      { git: true, config: (url) => providerCfg(url) },
    ),
  )

  it.live("should block process when session cost limit is exceeded", () =>
    provideTmpdirServer(
      ({ dir }) =>
        Effect.gen(function* () {
          const { processors, session, provider } = yield* boot()

          const root = yield* session.create({})

          // Set cost budget limit ($0.01) on root session directly in DB
          yield* Effect.sync(() =>
            Database.use((db) =>
              db.update(SessionTable).set({ max_cost: "0.01" }).where(eq(SessionTable.id, root.id)).run(),
            ),
          )

          const rootUser = yield* user(root.id, "hello")
          // Simulate having already used $0.015 — above the limit
          const msg = yield* assistant(root.id, rootUser.id, path.resolve(dir), 0.015, 100)

          const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
          const handle = yield* processors.create({
            assistantMessage: msg,
            sessionID: root.id,
            model: mdl,
          })

          const input = {
            user: {
              id: rootUser.id,
              sessionID: root.id,
              role: "user",
              time: rootUser.time,
              agent: rootUser.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: root.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "hello" }],
            tools: {},
          } satisfies LLM.StreamInput

          const run = yield* Effect.exit(handle.process(input))
          // Budget exceeded: process stops gracefully rather than throwing
          expect(Exit.isSuccess(run)).toBe(true)
          if (Exit.isSuccess(run)) {
            expect(run.value).toBe("stop")
          }
          expect(handle.message.error?.name).toBe("BudgetExceededError")
          expect((handle.message.error as any).data?.message).toContain("Session tree cost limit of $0.01 exceeded")
        }),
      { git: true, config: (url) => providerCfg(url) },
    ),
  )

  it.live("should block process when session token limit is exceeded", () =>
    provideTmpdirServer(
      ({ dir }) =>
        Effect.gen(function* () {
          const { processors, session, provider } = yield* boot()

          const root = yield* session.create({})

          yield* Effect.sync(() =>
            Database.use((db) =>
              db.update(SessionTable).set({ max_tokens: 100 }).where(eq(SessionTable.id, root.id)).run(),
            ),
          )

          const rootUser = yield* user(root.id, "hello")
          // 150 tokens used, limit is 100
          const msg = yield* assistant(root.id, rootUser.id, path.resolve(dir), 0.001, 150)

          const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
          const handle = yield* processors.create({
            assistantMessage: msg,
            sessionID: root.id,
            model: mdl,
          })

          const input = {
            user: {
              id: rootUser.id,
              sessionID: root.id,
              role: "user",
              time: rootUser.time,
              agent: rootUser.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: root.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "hello" }],
            tools: {},
          } satisfies LLM.StreamInput

          const run = yield* Effect.exit(handle.process(input))
          expect(Exit.isSuccess(run)).toBe(true)
          if (Exit.isSuccess(run)) {
            expect(run.value).toBe("stop")
          }
          expect(handle.message.error?.name).toBe("BudgetExceededError")
          expect((handle.message.error as any).data?.message).toContain("Session tree token limit of 100 exceeded")
        }),
      { git: true, config: (url) => providerCfg(url) },
    ),
  )
})
