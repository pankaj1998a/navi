import { describe, it, expect } from "bun:test"
import {
  loadAgencyCatalog,
  searchAgents,
  getAgentPrompt,
  listDivisions,
} from "../src/agent/agency"
import { native } from "../src/memory/native"

describe("The Agency Agents & NEXUS Orchestration Suite", () => {
  it("indexes the full agent roster across 18 divisions", () => {
    const catalog = loadAgencyCatalog()
    expect(catalog.length).toBeGreaterThanOrEqual(280) // 286 agents in roster

    const frontend = catalog.find((a) => a.id === "engineering-frontend-developer")
    expect(frontend).toBeDefined()
    expect(frontend?.name).toBe("Frontend Developer")
    expect(frontend?.division).toBe("engineering")
    expect(frontend?.emoji).toBe("🖥️")
  })

  it("lists all divisions with correct agent distributions", () => {
    const divs = listDivisions()
    expect(divs.length).toBeGreaterThanOrEqual(18)

    const engineering = divs.find((d) => d.id === "engineering")
    expect(engineering).toBeDefined()
    expect(engineering?.agentCount).toBeGreaterThan(60) // 65 engineering agents

    const testing = divs.find((d) => d.id === "testing")
    expect(testing).toBeDefined()
    expect(testing?.agentCount).toBeGreaterThan(5)
  })

  it("executes fast search with Rust scoring acceleration", () => {
    const results = searchAgents("Frontend Developer", undefined, 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.agent.name).toBe("Frontend Developer")
    expect(results[0]?.score).toBeGreaterThan(50)

    const testingResults = searchAgents("Evidence Collector", "testing", 5)
    expect(testingResults.length).toBeGreaterThan(0)
    expect(testingResults[0]?.agent.name).toBe("Evidence Collector")
    expect(testingResults[0]?.agent.division).toBe("testing")
  })

  it("loads full agent system prompt lazily on demand", () => {
    const prompt = getAgentPrompt("engineering-frontend-developer")
    expect(prompt).not.toBeNull()
    expect(prompt).toContain("Frontend Developer Agent Personality")
    expect(prompt).toContain("Core Web Vitals")
  })

  it("verifies native Rust FFI bindings for frontmatter and search", () => {
    expect(native.isAvailable).toBe(true)
    expect(typeof native.parseAgentFrontmatter).toBe("function")
    expect(typeof native.searchAgencyAgents).toBe("function")

    const sample = `---
name: Autonomous Test Agent
description: Verifies native FFI
color: purple
emoji: 🧪
vibe: Flawless verification.
---
# Instructions`

    const parsed = native.parseAgentFrontmatter!(sample, "testing/test-agent.md", "test-agent")
    expect(parsed).not.toBeNull()
    expect(parsed?.name).toBe("Autonomous Test Agent")
    expect(parsed?.color).toBe("purple")
    expect(parsed?.emoji).toBe("🧪")
  })
})
