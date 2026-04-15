import { describe, expect, test } from "bun:test"
import {
  collectPromptTaskText,
  formatBuildAdvisorNote,
  recommendAgentMode,
  shouldInjectBuildAdvisor,
} from "../../src/agent/mode-advisor"

describe("agent.mode-advisor", () => {
  test("collects task text from prompt input and text parts", () => {
    const text = collectPromptTaskText({
      input: "Refactor the auth flow",
      parts: [
        { type: "text", text: "Inspect the login path" },
        { type: "file", text: "ignored" },
        { type: "text", text: "Check the callback handler" },
      ],
    })

    expect(text).toContain("Refactor the auth flow")
    expect(text).toContain("Inspect the login path")
    expect(text).toContain("Check the callback handler")
  })

  test("flags ambiguous build tasks for advisor injection", () => {
    const recommendation = recommendAgentMode({
      task: "how should we handle this?",
      currentAgent: "build",
    })

    expect(recommendation.workflow).toBe("general")
    expect(shouldInjectBuildAdvisor(recommendation)).toBe(true)
    expect(formatBuildAdvisorNote(recommendation, "how should we handle this?")).toContain("Claude-style workflow hint")
    expect(formatBuildAdvisorNote(recommendation, "how should we handle this?")).toContain("Recommended agent: build")
  })
})
