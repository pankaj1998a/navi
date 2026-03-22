import { expect, test } from "bun:test"
import { MemoryFacts } from "../../src/agent/memory-facts"

function fact(content: string, confidence: number, createdAt: number, lastAccessed: number, fingerprint?: string) {
  return {
    id: `${content}-${confidence}`,
    tier: "medium",
    content,
    importance: confidence,
    accessCount: 0,
    createdAt,
    lastAccessed,
    tags: ["project-fact", "project:project-1", "fact:constraint", "fingerprint:test"],
    metadata: {
      kind: "constraint",
      confidence,
      fingerprint: fingerprint ?? `fp-${content}`,
      projectID: "project-1",
      source: { type: "session-compaction", projectID: "project-1" },
    },
  } as any
}

test("memory hygiene deduplicates project facts and keeps the stronger contradiction", () => {
  const entries = [
    fact("Enable browser action", 0.9, 1, 3, "shared"),
    fact("Enable browser action", 0.7, 2, 2, "shared"),
    fact("Disable browser action", 0.8, 3, 1),
  ]

  const cleaned = MemoryFacts.resolveProjectFacts(entries)
  expect(cleaned).toHaveLength(1)
  expect(cleaned[0].content).toContain("Enable browser action")
})

test("memory hygiene caps the number of facts per kind", () => {
  const entries = [
    fact("Keep A", 0.95, 1, 5, "a"),
    fact("Keep B", 0.94, 2, 4, "b"),
    fact("Keep C", 0.93, 3, 3, "c"),
    fact("Keep D", 0.92, 4, 2, "d"),
    fact("Keep E", 0.91, 5, 1, "e"),
  ]

  const cleaned = MemoryFacts.resolveProjectFacts(entries, { maxPerKind: 3 })
  expect(cleaned).toHaveLength(3)
  expect(cleaned.map((entry) => entry.content)).toEqual([
    "Keep A",
    "Keep B",
    "Keep C",
  ])
})
