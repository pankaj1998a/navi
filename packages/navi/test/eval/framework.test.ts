import { expect, test } from "bun:test"
import { EvalFramework } from "../../src/eval/framework"
import { getVerificationProfile } from "../../src/eval/catalog"

test("benchmarks expose the core evaluation modes", () => {
  const benchmarks = EvalFramework.benchmarks()
  expect(benchmarks.some((benchmark) => benchmark.mode === "build")).toBe(true)
  expect(benchmarks.some((benchmark) => benchmark.mode === "vibemode")).toBe(true)
  expect(benchmarks.some((benchmark) => benchmark.mode === "researcher")).toBe(true)
})

test("summarizeTurns computes pass rate and averages", () => {
  const summary = EvalFramework.summarizeTurns([
    {
      sessionID: "session-1",
      step: 1,
      agent: "build",
      requestedModel: "openai/gpt-5",
      routedModel: "openai/gpt-5",
      toolCalls: 4,
      questionCount: 1,
      cost: 0.25,
      finish: "stop",
    },
    {
      sessionID: "session-2",
      step: 1,
      agent: "build",
      requestedModel: "openai/gpt-5",
      routedModel: "openai/gpt-5",
      toolCalls: 2,
      questionCount: 0,
      cost: 0.15,
      finish: "stop",
      error: "failed",
    },
  ])

  expect(summary.count).toBe(2)
  expect(summary.completed).toBe(1)
  expect(summary.failed).toBe(1)
  expect(summary.passRate).toBe(0.5)
  expect(summary.avgToolCalls).toBe(3)
})

test("verification profiles exist for build and researcher workflows", () => {
  expect(getVerificationProfile("build")?.gates.length).toBeGreaterThan(0)
  expect(getVerificationProfile("researcher")?.gates.length).toBeGreaterThan(0)
})
