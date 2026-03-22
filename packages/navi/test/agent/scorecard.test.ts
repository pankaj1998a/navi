import { beforeEach, expect, test } from "bun:test"
import { AgentScorecard } from "../../src/agent/scorecard"

beforeEach(async () => {
  await AgentScorecard.reset()
})

test("agent scorecards persist and summarize runtime performance", async () => {
  await AgentScorecard.record({
    taskClass: "build",
    agentName: "coding",
    success: true,
    latencyMs: 1200,
    cost: 0.01,
    toolCalls: 3,
    questionCount: 1,
  })
  await AgentScorecard.record({
    taskClass: "build",
    agentName: "coding",
    success: false,
    latencyMs: 2500,
    cost: 0.02,
    toolCalls: 5,
    questionCount: 2,
  })

  const summary = await AgentScorecard.get("build", "coding")
  expect(summary).toBeDefined()
  expect(summary?.samples).toBe(2)
  expect(summary?.successRate).toBeCloseTo(0.5)
  expect(summary?.avgLatencyMs).toBeCloseTo(1850)
})

test("agent scorecards rank the best task-fit agent first", async () => {
  await AgentScorecard.record({
    taskClass: "build",
    agentName: "coding",
    success: true,
    latencyMs: 1200,
    cost: 0.01,
    toolCalls: 3,
    questionCount: 1,
  })
  await AgentScorecard.record({
    taskClass: "build",
    agentName: "review",
    success: true,
    latencyMs: 250,
    cost: 0.005,
    toolCalls: 1,
    questionCount: 0,
  })

  const ranked = await AgentScorecard.rankAgentsForTask("build", ["coding", "review"])
  expect(ranked[0].agentName).toBe("review")
  expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
})
