import { expect, test } from "bun:test"
import { MemoryFacts } from "../../src/agent/memory-facts"

test("memory facts extract structured compaction sections", () => {
  const facts = MemoryFacts.extractFromCompaction({
    objective: ["Improve persistent memory"],
    completed: ["Added compaction summaries"],
    inProgress: ["Adding project facts"],
    files: ["src/session/compaction.ts"],
    constraints: ["Keep summaries concise"],
    decisions: ["Persist per-project facts"],
    nextSteps: ["Add hygiene cleanup"],
  })

  expect(facts.map((fact) => fact.kind)).toEqual([
    "objective",
    "completed",
    "in-progress",
    "file",
    "constraint",
    "decision",
    "next-step",
  ])
  expect(facts[0].confidence).toBe(0.75)
  expect(facts[1].confidence).toBe(0.9)
  expect(facts[3].ttlMs).toBe(14 * 24 * 60 * 60 * 1000)
})

test("memory facts render project facts with source and confidence", () => {
  const rendered = MemoryFacts.renderProjectFacts([
    {
      id: "mem-1",
      tier: "medium",
      content: "decision: keep structured compaction summaries [confidence 90%, source: session compaction]",
      importance: 0.9,
      accessCount: 0,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      tags: ["project-fact"],
      metadata: {
        confidence: 0.9,
        source: { type: "session-compaction", sessionID: "session-1", projectID: "project-1" },
      },
    } as any,
  ])

  expect(rendered).toContain("## Relevant Project Facts")
  expect(rendered).toContain("[90%]")
  expect(rendered).toContain("session session-1")
})
