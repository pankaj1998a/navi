import { expect, test } from "bun:test"
import { SystemPrompt } from "../../src/session/system"

test("verification prompt exists for build mode", () => {
  const prompts = SystemPrompt.verification("build")
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain("<verification_profile")
  expect(prompts[0]).toContain("lint")
  expect(prompts[0]).toContain("tests")
})

test("verification prompt is omitted for modes without a profile", () => {
  const prompts = SystemPrompt.verification("general")
  expect(prompts).toEqual([])
})

test("orchestration prompt exists for vibemode", () => {
  const prompts = SystemPrompt.orchestration("vibemode")
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain("<orchestration_profile")
  expect(prompts[0]).toContain("Plan the next chunk of work before delegating")
  expect(prompts[0]).toContain("Run a reviewer or QA pass before finalizing")
})

test("orchestration prompt is omitted for non-orchestrator modes", () => {
  const prompts = SystemPrompt.orchestration("build")
  expect(prompts).toEqual([])
})
