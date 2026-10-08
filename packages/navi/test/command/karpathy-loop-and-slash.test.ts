import { afterEach, test, expect } from "bun:test"
import { Effect } from "effect"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"
import { WithInstance } from "../../src/project/with-instance"
import { Agent } from "../../src/agent/agent"
import { Command } from "../../src/command"
import fs from "fs"
import path from "path"

afterEach(async () => {
  await disposeAllInstances()
})

test("Agent.Service loads karpathy-loop agent with proper configuration", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agent = await Effect.runPromise(
        provideInstance(tmp.path)(Agent.Service.use((svc) => svc.get("karpathy-loop"))).pipe(
          Effect.provide(Agent.defaultLayer),
        ),
      )
      expect(agent).toBeDefined()
      expect(agent.name).toBe("karpathy-loop")
      expect(agent.mode).toBe("subagent")
      expect(agent.native).toBe(true)
      expect(agent.prompt).toContain("Karpathy Loop")
      expect(agent.prompt).toContain("Immutable Evaluation Harness")
      expect(agent.prompt).toContain("git commit")
      expect(agent.prompt).toContain("git reset")
    },
  })
}, 30000)

test("Command.Service registers loop and karpathy-loop commands", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const loopCmd = await Effect.runPromise(
        provideInstance(tmp.path)(Command.Service.use((svc) => svc.get("loop"))).pipe(
          Effect.provide(Command.defaultLayer),
        ),
      )
      expect(loopCmd).toBeDefined()
      expect(loopCmd?.name).toBe("loop")
      expect(loopCmd?.agent).toBe("karpathy-loop")
      expect(typeof loopCmd?.template).toBe("string")
      expect(String(loopCmd?.template)).toContain("Karpathy Experiment Loop")

      const kLoopCmd = await Effect.runPromise(
        provideInstance(tmp.path)(Command.Service.use((svc) => svc.get("karpathy-loop"))).pipe(
          Effect.provide(Command.defaultLayer),
        ),
      )
      expect(kLoopCmd).toBeDefined()
      expect(kLoopCmd?.agent).toBe("karpathy-loop")
    },
  })
})

test("Command.Service registers new slash commands: cost, checkpoint, rewind, diff, doctor, goal, grill-me, learn, schedule", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const commandsToTest = [
        "cost",
        "checkpoint",
        "rewind",
        "diff",
        "doctor",
        "goal",
        "grill-me",
        "learn",
        "schedule",
        "recap",
      ]

      for (const cmdName of commandsToTest) {
        const cmd = await Effect.runPromise(
          provideInstance(tmp.path)(Command.Service.use((svc) => svc.get(cmdName))).pipe(
            Effect.provide(Command.defaultLayer),
          ),
        )
        expect(cmd).toBeDefined()
        expect(cmd?.name).toBe(cmdName)
        expect(cmd?.template).toBeDefined()
        expect(String(cmd?.template).length).toBeGreaterThan(10)
      }
    },
  })
})

test("karpathy-loop skill file exists and has correct frontmatter", () => {
  const skillFile = path.resolve(__dirname, "../../skills/karpathy-loop/SKILL.md")
  expect(fs.existsSync(skillFile)).toBe(true)
  const content = fs.readFileSync(skillFile, "utf-8")
  expect(content).toContain("name: karpathy-loop")
  expect(content).toContain("description:")
  expect(content).toContain("The Karpathy Coding Loop")
})

test("archiveSegment creates .navi/compaction/segment_001.md and INDEX.md (Grok Build pattern)", async () => {
  const { archiveSegment } = await import("../../src/session/segmented-compaction")
  await using tmp = await tmpdir()
  const res = archiveSegment({
    worktree: tmp.path,
    sessionID: "ses-test-123",
    messages: [
      {
        info: { id: "m1" as any, role: "user" as const, time: { created: Date.now() } } as any,
        parts: [{ type: "text" as const, text: "Build the database schema" } as any],
      },
      {
        info: { id: "m2" as any, role: "assistant" as const, time: { created: Date.now() } } as any,
        parts: [{ type: "tool" as const, tool: "write", state: { status: "completed" } } as any],
      },
    ],
    summary: "Created initial database tables and migrations",
    detail: "balanced",
  })

  expect(res).toBeDefined()
  expect(res?.segmentNumber).toBe(1)
  expect(fs.existsSync(res!.segmentFile)).toBe(true)
  expect(fs.existsSync(res!.indexFile)).toBe(true)

  const segContent = fs.readFileSync(res!.segmentFile, "utf-8")
  expect(segContent).toContain("Compaction Segment 001")
  expect(segContent).toContain("Build the database schema")

  const indexContent = fs.readFileSync(res!.indexFile, "utf-8")
  expect(indexContent).toContain("Session Compaction Index")
  expect(indexContent).toContain("001")
  expect(indexContent).toContain("segment_001.md")
})
