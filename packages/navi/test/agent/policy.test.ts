import { expect, test } from "bun:test"
import { AgentPolicy } from "../../src/agent/policy"

test("resolve applies agent defaults and overrides", () => {
  const policy = AgentPolicy.resolve("vibemode", {
    maxToolCalls: 4,
  })

  expect(policy.maxIterations).toBeGreaterThan(0)
  expect(policy.maxToolCalls).toBe(4)
  expect(policy.maxDelegations).toBeGreaterThan(0)
})
