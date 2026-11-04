import { expect, test } from "bun:test"
import { formatSwarmSummary, SwarmMailbox } from "../../src/tool/swarm"

test("formatSwarmSummary handles all-failed swarm execution truthfully", () => {
  const summary = formatSwarmSummary({
    objective: "Investigate crash",
    results: [
      {
        name: "Agent1",
        role: "Researcher",
        task: "Find logs",
        status: "failed",
        sessionId: "s1",
        elapsedMs: 120,
        findings: "Teammate execution failed: out of memory",
      },
      {
        name: "Agent2",
        role: "Debugger",
        task: "Check core dump",
        status: "failed",
        sessionId: "s2",
        elapsedMs: 80,
        findings: "Teammate execution failed: connection refused",
      },
    ],
  })

  expect(summary.status).toBe("failed")
  expect(summary.failedCount).toBe(2)
  expect(summary.completedCount).toBe(0)
  expect(summary.title).toBe('Swarm Failed: 2 errors for "Investigate crash"')
  expect(summary.summaryNotice).toContain("all 2 agent teammates encountered errors")
})

test("formatSwarmSummary accurately reports partial failures", () => {
  const summary = formatSwarmSummary({
    objective: "Run full analysis",
    results: [
      {
        name: "Agent1",
        role: "Researcher",
        task: "Task 1",
        status: "completed",
        sessionId: "s1",
        elapsedMs: 200,
        findings: "Completed task 1",
      },
      {
        name: "Agent2",
        role: "Reviewer",
        task: "Task 2",
        status: "failed",
        sessionId: "s2",
        elapsedMs: 50,
        findings: "Error in task 2",
      },
      {
        name: "Agent3",
        role: "Writer",
        task: "Task 3",
        status: "completed",
        sessionId: "s3",
        elapsedMs: 180,
        findings: "Completed task 3",
      },
    ],
  })

  expect(summary.status).toBe("partial")
  expect(summary.completedCount).toBe(2)
  expect(summary.failedCount).toBe(1)
  expect(summary.title).toBe('Swarm Partial (2/3 completed) for "Run full analysis"')
  expect(summary.summaryNotice).toContain("2 succeeded, 1 failed (3 total)")
})

test("formatSwarmSummary reports full success when all teammates complete", () => {
  const summary = formatSwarmSummary({
    objective: "Deploy service",
    results: [
      {
        name: "Agent1",
        role: "Dev",
        task: "Build",
        status: "completed",
        sessionId: "s1",
        elapsedMs: 150,
        findings: "Built successfully",
      },
      {
        name: "Agent2",
        role: "QA",
        task: "Verify",
        status: "completed",
        sessionId: "s2",
        elapsedMs: 130,
        findings: "Verified successfully",
      },
    ],
  })

  expect(summary.status).toBe("completed")
  expect(summary.completedCount).toBe(2)
  expect(summary.failedCount).toBe(0)
  expect(summary.title).toBe('Swarm Completed: 2 agents for "Deploy service"')
  expect(summary.summaryNotice).toContain("completed successfully with all 2 agent teammates")
})

test("formatSwarmSummary handles initialized / staged teammates", () => {
  const summary = formatSwarmSummary({
    objective: "Staged deployment",
    results: [
      {
        name: "Agent1",
        role: "Planner",
        task: "Plan",
        status: "initialized",
        sessionId: "s1",
        elapsedMs: 0,
        findings: "Staged",
      },
    ],
  })

  expect(summary.status).toBe("initialized")
  expect(summary.title).toBe('Swarm Initialized: 1 agents for "Staged deployment"')
  expect(summary.summaryNotice).toContain("Swarm initialized with 1 staged agent teammates")
})

test("SwarmMailbox correctly posts, retrieves, and clears peer messages", () => {
  const swarmId = "test-swarm-xyz"
  SwarmMailbox.clear(swarmId)

  SwarmMailbox.post(swarmId, {
    from: "AgentA",
    role: "Scout",
    timestamp: "2026-11-05T00:00:00Z",
    content: "Found target",
  })
  SwarmMailbox.post(swarmId, {
    from: "AgentB",
    role: "Sniper",
    timestamp: "2026-11-05T00:00:01Z",
    content: "Target locked",
  })

  const msgs = SwarmMailbox.getMessages(swarmId)
  expect(msgs).toHaveLength(2)
  const [firstMsg, secondMsg] = msgs
  expect(firstMsg?.from).toBe("AgentA")
  expect(secondMsg?.content).toBe("Target locked")

  SwarmMailbox.clear(swarmId)
  expect(SwarmMailbox.getMessages(swarmId)).toHaveLength(0)
})

